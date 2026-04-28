import type { Result } from "@bedrock/ocale";

import { readFile as nodeReadFile } from "node:fs/promises";

import { buildState } from "../core/migrate/build-state.ts";
import { type EnvironmentFoldResult, foldEnvironment } from "../core/migrate/fold-environment.ts";
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
	type PlaceEntry,
	validateConfig,
} from "../core/schema.ts";
import type { BedrockState } from "../core/state.ts";

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

interface FinalizeReportContext {
	readonly configFormat: ConfigFormat;
	readonly folds: ReadonlyMap<string, EnvironmentFoldResult>;
}

/**
 * Read a Mantle state file and produce a `MigrationReport` containing a
 * bedrock config, per-environment `BedrockState`s, and a structured list
 * of fields that did not migrate verbatim.
 *
 * Skeleton: handles single-environment or multi-environment states with
 * universe and place resources. The primary environment auto-picks when
 * only one environment is present; multi-environment inputs without an
 * explicit `primaryEnvironment` return
 * `Err({ kind: "primaryEnvironmentRequired", available })` so the
 * migrator never silently picks a winner. Future slices fold game
 * passes, social links, and the deferred / blocked warning categories.
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

	return assembleReport(parsed.data, deps);
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
	const universe = primaryFold?.universe?.entry;

	const config: Config = { environments };
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
): Readonly<Record<string, BedrockState>> {
	return Object.fromEntries(
		[...folds.entries()].map(([name, folded]): [string, BedrockState] => [
			name,
			buildState(name, folded),
		]),
	);
}

function prefixMantlePath(warning: MigrationWarning, environmentName: string): MigrationWarning {
	return { ...warning, mantlePath: `${environmentName}.${warning.mantlePath}` };
}

function collectWarnings(
	folds: ReadonlyMap<string, EnvironmentFoldResult>,
): ReadonlyArray<MigrationWarning> {
	return [...folds.entries()].flatMap(([name, fold]) => {
		return fold.warnings.map((warning) => prefixMantlePath(warning, name));
	});
}

function buildSuccessfulReport(validated: Config, context: FinalizeReportContext): MigrationReport {
	const warnings = collectWarnings(context.folds);
	return {
		config: validated,
		configFileContent: serializeConfig({
			config: validated,
			configFormat: context.configFormat,
		}),
		statesByEnvironment: buildStatesByEnvironment(context.folds),
		summary: summarizeWarnings(warnings),
		warnings,
	};
}

function finalizeReport(
	config: Config,
	context: FinalizeReportContext,
): Result<MigrationReport, MigrateError> {
	const validated = validateConfig(config, "<migrate-mantle-state>");
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

	return { data: buildSuccessfulReport(validated.data, context), success: true };
}

function assembleReport(
	state: MantleStateV6,
	deps: Pick<MigrateMantleStateDeps, "configFormat" | "primaryEnvironment">,
): Result<MigrationReport, MigrateError> {
	const available = Object.keys(state.environments);
	const primaryResult = pickPrimary(available, deps.primaryEnvironment);
	if (!primaryResult.success) {
		return primaryResult;
	}

	const folds: ReadonlyMap<string, EnvironmentFoldResult> = new Map(
		available.map((name) => [name, foldEnvironment(state.environments[name] ?? [])]),
	);
	return finalizeReport(buildConfig(folds, primaryResult.data), {
		configFormat: deps.configFormat,
		folds,
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
