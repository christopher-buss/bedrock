import type { Result } from "@bedrock/ocale";

import { readFile as nodeReadFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { sha256Hex } from "../core/kinds/hash.ts";
import { buildState } from "../core/migrate/build-state.ts";
import { type EnvironmentFoldResult, foldEnvironment } from "../core/migrate/fold-environment.ts";
import type { PassFoldEntry } from "../core/migrate/fold-passes.ts";
import type { PlaceFoldEntry } from "../core/migrate/fold-places.ts";
import type {
	MigrateError,
	MigrationReport,
	MigrationWarning,
} from "../core/migrate/migration-report.ts";
import { parseState } from "../core/migrate/parse-state.ts";
import { serializeConfig } from "../core/migrate/serialize-config.ts";
import { summarizeWarnings } from "../core/migrate/summarize-warnings.ts";
import type { MantleStateV6 } from "../core/migrate/types.ts";
import {
	type Config,
	type EnvironmentEntry,
	type GamePassEntry,
	type PlaceEntry,
	validateConfig,
} from "../core/schema.ts";
import type { BedrockState } from "../core/state.ts";
import { asSha256Hex, type ResourceKey, type Sha256Hex } from "../types/ids.ts";

type ConfigFormat = "typescript" | "yaml";
type PlaceOverlayEntry = NonNullable<EnvironmentEntry["places"]>[string];

const FILE_MISSING_CODES = new Set(["ENOENT"]);

/**
 * Inputs for `migrateMantleState`. The state file is read via
 * `readFile` (defaults to `node:fs/promises.readFile`) so callers can
 * inject in-memory fixtures from tests and the JSDoc `@example` block
 * stays self-contained.
 *
 * `configFormat` selects the output shape: `"typescript"` emits a
 * `bedrock.config.ts` with `defineConfig({...})`; `"yaml"` emits a
 * `bedrock.config.yaml` body. Both shapes round-trip through
 * `loadConfig` cleanly.
 */
export interface MigrateMantleStateDeps {
	/**
	 * Output format for the emitted bedrock config file. `"typescript"`
	 * produces a `defineConfig({...})` module; `"yaml"` produces a YAML
	 * body whose keys match the `Config` schema.
	 */
	readonly configFormat: ConfigFormat;
	/**
	 * Environment in the input state file whose resolved values seed
	 * the root config. Required when the state file declares more than
	 * one environment; ignored when only one environment is present.
	 */
	readonly primaryEnvironment?: string;
	/**
	 * Reads file bytes; defaults to `node:fs/promises.readFile`. Kept
	 * `Uint8Array`-typed to match `deploy`, `buildDesired`, and
	 * `buildDefaultRegistry`. UTF-8 decoding happens inside the migrator
	 * before YAML parsing.
	 */
	readonly readFile?: (path: string) => Promise<Uint8Array>;
	/** Absolute path to the `.mantle-state.yml` file to migrate. */
	readonly stateFilePath: string;
}

interface EnvironmentOverlayContext {
	readonly fold: EnvironmentFoldResult;
	readonly primary: EnvironmentFoldResult | undefined;
}

interface PlaceOverlayContext {
	readonly fold: PlaceFoldEntry;
	readonly primary: PlaceFoldEntry | undefined;
}

interface IconHashRecomputation {
	readonly hashesByEnvironment: ReadonlyMap<string, ReadonlyMap<ResourceKey, Sha256Hex>>;
	readonly warnings: ReadonlyArray<MigrationWarning>;
}

interface RecomputeIconHashesInputs {
	readonly folds: ReadonlyMap<string, EnvironmentFoldResult>;
	readonly readFile: (path: string) => Promise<Uint8Array>;
	readonly stateFileDirectory: string;
}

interface FinalizeReportInputs {
	readonly config: Config;
	readonly configFormat: ConfigFormat;
	readonly folds: ReadonlyMap<string, EnvironmentFoldResult>;
	readonly iconRecomputation: IconHashRecomputation;
}

interface AssembleReportInputs {
	readonly configFormat: ConfigFormat;
	readonly primaryEnvironment: string | undefined;
	readonly readFile: (path: string) => Promise<Uint8Array>;
	readonly state: MantleStateV6;
	readonly stateFilePath: string;
}

/**
 * Read a Mantle state file and produce a `MigrationReport` containing a
 * bedrock config, per-environment `BedrockState`s, and a structured list
 * of fields that did not migrate verbatim.
 *
 * Skeleton: handles single-environment or multi-environment states with
 * universe, place, and game-pass resources. The primary environment
 * auto-picks when only one environment is present; multi-environment
 * inputs without an explicit `primaryEnvironment` return
 * `Err({ kind: "primaryEnvironmentRequired", available })` so the
 * migrator never silently picks a winner. Future slices add social
 * links and the deferred / blocked warning categories.
 *
 * @param deps - Inputs for the migration.
 * @returns `Ok` with a `MigrationReport` on success, or `Err` with a
 *   discriminated `MigrateError` on failure.
 * @rejects Re-thrown `readFile` failure when the underlying error code is
 *   not in the recognized "missing file" set; surfaced so callers see
 *   permission or filesystem outages instead of having them coerced to
 *   `stateFileNotFound`.
 * @example
 *
 * ```ts
 * import { migrateMantleState } from "@bedrock/core";
 *
 * const yaml = [
 *     'version: "6"',
 *     "environments:",
 *     "  production:",
 *     "    - id: experience_singleton",
 *     "      inputs:",
 *     "        experience:",
 *     "          groupId: ~",
 *     "      outputs:",
 *     "        experience:",
 *     "          assetId: 6031475575",
 *     "          startPlaceId: 17613681043",
 *     "      dependencies: []",
 *     "",
 * ].join("\n");
 *
 * async function readFile(): Promise<Uint8Array> {
 *     return new TextEncoder().encode(yaml);
 * }
 *
 * return migrateMantleState({
 *     configFormat: "typescript",
 *     readFile,
 *     stateFilePath: ".mantle-state.yml",
 * }).then((result) => {
 *     expect(result.success).toBeTrue();
 *     if (result.success) {
 *         expect(result.data.config.universe?.universeId).toBe("6031475575");
 *     }
 * });
 * ```
 */
export async function migrateMantleState(
	deps: MigrateMantleStateDeps,
): Promise<Result<MigrationReport, MigrateError>> {
	const readFile = deps.readFile ?? nodeReadFile;

	let bytes: Uint8Array;
	try {
		bytes = await readFile(deps.stateFilePath);
	} catch (err) {
		if (isFileMissing(err)) {
			return {
				err: { kind: "stateFileNotFound", path: deps.stateFilePath },
				success: false,
			};
		}

		throw err;
	}

	const raw = new TextDecoder("utf-8").decode(bytes);
	const parsed = parseState(raw, deps.stateFilePath);
	if (!parsed.success) {
		return parsed;
	}

	return assembleReport({
		configFormat: deps.configFormat,
		primaryEnvironment: deps.primaryEnvironment,
		readFile,
		state: parsed.data,
		stateFilePath: deps.stateFilePath,
	});
}

async function tryRecomputeHash(
	readFile: (path: string) => Promise<Uint8Array>,
	path: string,
): Promise<Sha256Hex | undefined> {
	try {
		const bytes = await readFile(path);
		return asSha256Hex(await sha256Hex(bytes));
	} catch {
		return undefined;
	}
}

function buildAmbiguousIconWarning(entry: PassFoldEntry, resolvedPath: string): MigrationWarning {
	return {
		hint: `Could not read icon file at ${resolvedPath}; verify the file's location relative to the state file or correct the iconFilePath before re-running.`,
		kind: "ambiguous",
		mantlePath: entry.mantlePath,
	};
}

async function recomputeIconHashes(
	inputs: RecomputeIconHashesInputs,
): Promise<IconHashRecomputation> {
	const warnings: Array<MigrationWarning> = [];
	const hashesByEnvironment = new Map<string, ReadonlyMap<ResourceKey, Sha256Hex>>();

	for (const [environment, folded] of inputs.folds) {
		const perKey = new Map<ResourceKey, Sha256Hex>();
		for (const passEntry of folded.passes) {
			const resolved = join(inputs.stateFileDirectory, passEntry.entry.iconFilePath);
			const recomputed = await tryRecomputeHash(inputs.readFile, resolved);
			if (recomputed === undefined) {
				warnings.push(prefixMantlePath(buildAmbiguousIconWarning(passEntry, resolved), environment));
			} else {
				perKey.set(passEntry.key, recomputed);
			}
		}

		hashesByEnvironment.set(environment, perKey);
	}

	return { hashesByEnvironment, warnings };
}

function pickPrimary(
	available: ReadonlyArray<string>,
	requested: string | undefined,
): Result<string, MigrateError> {
	if (requested === undefined) {
		const [only, ...rest] = available;
		if (only === undefined || rest.length > 0) {
			return {
				err: { available, kind: "primaryEnvironmentRequired" },
				success: false,
			};
		}

		return { data: only, success: true };
	}

	if (!available.includes(requested)) {
		return {
			err: { available, kind: "primaryEnvironmentNotFound", requested },
			success: false,
		};
	}

	return { data: requested, success: true };
}

function buildRootPlaces(
	primaryFold: EnvironmentFoldResult | undefined,
): Record<string, PlaceEntry> | undefined {
	if (primaryFold === undefined || primaryFold.places.size === 0) {
		return undefined;
	}

	return Object.fromEntries(
		[...primaryFold.places.entries()].map(([key, fold]) => [key, { ...fold.entry }]),
	);
}

function buildPassesRecord(
	entries: ReadonlyArray<{ readonly entry: GamePassEntry; readonly key: string }>,
): Record<string, GamePassEntry> | undefined {
	if (entries.length === 0) {
		return undefined;
	}

	return Object.fromEntries(entries.map(({ entry, key }) => [key, entry]));
}

function buildPlaceOverlayEntry(context: PlaceOverlayContext): PlaceOverlayEntry {
	const { fold, primary } = context;
	if (primary === undefined || primary.entry.filePath === fold.entry.filePath) {
		return { placeId: fold.placeId };
	}

	return { filePath: fold.entry.filePath, placeId: fold.placeId };
}

function buildPlacesOverlay(
	context: EnvironmentOverlayContext,
): Record<string, PlaceOverlayEntry> | undefined {
	const { fold, primary } = context;
	if (fold.places.size === 0) {
		return undefined;
	}

	const overlay: Record<string, PlaceOverlayEntry> = {};
	for (const [key, foldEntry] of fold.places) {
		overlay[key] = buildPlaceOverlayEntry({
			fold: foldEntry,
			primary: primary?.places.get(key),
		});
	}

	return overlay;
}

function buildEnvironmentEntry(context: EnvironmentOverlayContext): EnvironmentEntry {
	const places = buildPlacesOverlay(context);
	if (places === undefined) {
		return {};
	}

	return { places };
}

function buildEnvironmentEntries(
	folds: ReadonlyMap<string, EnvironmentFoldResult>,
	primaryName: string,
): Record<string, EnvironmentEntry> {
	const primaryFold = folds.get(primaryName);
	const entries: Record<string, EnvironmentEntry> = {};
	for (const [name, fold] of folds) {
		entries[name] = buildEnvironmentEntry({ fold, primary: primaryFold });
	}

	return entries;
}

function buildConfig(
	folds: ReadonlyMap<string, EnvironmentFoldResult>,
	primaryName: string,
): Config {
	const primaryFold = folds.get(primaryName);
	const environments = buildEnvironmentEntries(folds, primaryName);
	const places = buildRootPlaces(primaryFold);
	const passes = buildPassesRecord(primaryFold?.passes ?? []);
	const universe = primaryFold?.universe?.entry;

	const config: Config = { environments };
	if (passes !== undefined) {
		config.passes = passes;
	}

	if (places !== undefined) {
		config.places = places;
	}

	if (universe !== undefined) {
		config.universe = universe;
	}

	return config;
}

function buildStatesByEnvironment(
	folds: ReadonlyMap<string, EnvironmentFoldResult>,
	hashesByEnvironment: ReadonlyMap<string, ReadonlyMap<ResourceKey, Sha256Hex>>,
): Readonly<Record<string, BedrockState>> {
	return Object.fromEntries(
		[...folds.entries()].map(([name, folded]): [string, BedrockState] => [
			name,
			buildState({
				environment: name,
				folded,
				iconHashesByKey: hashesByEnvironment.get(name) ?? new Map(),
			}),
		]),
	);
}

function prefixMantlePath(warning: MigrationWarning, environmentName: string): MigrationWarning {
	return { ...warning, mantlePath: `${environmentName}.${warning.mantlePath}` };
}

function collectFoldWarnings(
	folds: ReadonlyMap<string, EnvironmentFoldResult>,
): ReadonlyArray<MigrationWarning> {
	return [...folds.entries()].flatMap(([name, fold]) =>
		fold.warnings.map((warning) => prefixMantlePath(warning, name)),
	);
}

function finalizeReport(inputs: FinalizeReportInputs): Result<MigrationReport, MigrateError> {
	const validated = validateConfig(inputs.config, "<migrate-mantle-state>");
	if (!validated.success) {
		return {
			err: {
				cause: validated.err,
				kind: "internalError",
				reason: "migrator emitted a config that failed validateConfig",
			},
			success: false,
		};
	}

	const { hashesByEnvironment, warnings: iconWarnings } = inputs.iconRecomputation;
	const warnings = [...collectFoldWarnings(inputs.folds), ...iconWarnings];
	return {
		data: {
			config: validated.data,
			configFileContent: serializeConfig({
				config: validated.data,
				configFormat: inputs.configFormat,
			}),
			statesByEnvironment: buildStatesByEnvironment(inputs.folds, hashesByEnvironment),
			summary: summarizeWarnings(warnings),
			warnings,
		},
		success: true,
	};
}

async function assembleReport(
	inputs: AssembleReportInputs,
): Promise<Result<MigrationReport, MigrateError>> {
	const available = Object.keys(inputs.state.environments);
	const primaryResult = pickPrimary(available, inputs.primaryEnvironment);
	if (!primaryResult.success) {
		return primaryResult;
	}

	const folds: ReadonlyMap<string, EnvironmentFoldResult> = new Map(
		available.map((name) => [name, foldEnvironment(inputs.state.environments[name] ?? [])]),
	);
	const iconRecomputation = await recomputeIconHashes({
		folds,
		readFile: inputs.readFile,
		stateFileDirectory: dirname(inputs.stateFilePath),
	});
	return finalizeReport({
		config: buildConfig(folds, primaryResult.data),
		configFormat: inputs.configFormat,
		folds,
		iconRecomputation,
	});
}

function isFileMissing(err: unknown): boolean {
	return (
		typeof err === "object" &&
		err !== null &&
		"code" in err &&
		typeof err.code === "string" &&
		FILE_MISSING_CODES.has(err.code)
	);
}
