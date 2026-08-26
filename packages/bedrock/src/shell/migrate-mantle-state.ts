import type { Result } from "@bedrock-rbx/ocale";

import { readFile as nodeReadFile } from "node:fs/promises";
import { dirname } from "node:path";

import { buildState } from "../core/migrate/build-state.ts";
import { factorizeEnvironments } from "../core/migrate/factorize-environments.ts";
import { type EnvironmentFoldResult, foldEnvironment } from "../core/migrate/fold-environment.ts";
import type {
	MigrateError,
	MigrationReport,
	MigrationWarning,
} from "../core/migrate/migration-report.ts";
import { parseState } from "../core/migrate/parse-state.ts";
import { serializeConfig } from "../core/migrate/serialize-config.ts";
import { summarizeWarnings } from "../core/migrate/summarize-warnings.ts";
import type { MantleStateV6 } from "../core/migrate/types.ts";
import { type Config, validateConfig } from "../core/schema.ts";
import type { BedrockState } from "../core/state.ts";
import type { ResourceKey, Sha256Hex } from "../types/ids.ts";
import { type IconHashRecomputation, recomputeIconHashesAsync } from "./recompute-icon-hashes.ts";

type ConfigFormat = "typescript" | "yaml";

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
 *
 * @since 0.1.0
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
	/**
	 * The foreign state file's bytes, when the caller already has them.
	 * Supplying them skips the read of `stateFilePath`, which is what lets
	 * a **State port** plugin fetch the bytes from coordinates only it
	 * understands while core keeps owning the format. `stateFilePath` is
	 * still what icon paths resolve against and what a parse failure is
	 * reported at.
	 */
	readonly stateFileBytes?: Uint8Array;
	/** Absolute path to the `.mantle-state.yml` file to migrate. */
	readonly stateFilePath: string;
}

interface FinalizeReportInputs {
	readonly config: Config;
	readonly configFormat: ConfigFormat;
	readonly factorizeWarnings: ReadonlyArray<MigrationWarning>;
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
 * @since 0.1.0
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
 * import { migrateMantleState } from "@bedrock-rbx/core";
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

	const sourced = await readStateBytesAsync(deps, readFile);
	if (!sourced.success) {
		return sourced;
	}

	const bytes = sourced.data;
	const decoder = new TextDecoder("utf-8");
	const raw = decoder.decode(bytes);
	const parsed = parseState(raw, deps.stateFilePath);
	if (!parsed.success) {
		return parsed;
	}

	return assembleReportAsync({
		configFormat: deps.configFormat,
		primaryEnvironment: deps.primaryEnvironment,
		readFile,
		state: parsed.data,
		stateFilePath: deps.stateFilePath,
	});
}

/**
 * Produce the foreign state file's bytes: the caller's, when it supplied
 * them, and otherwise whatever `readFile` finds at `stateFilePath`.
 *
 * @param deps - The migrator's inputs.
 * @param readFile - The reader to fall back on.
 * @returns The bytes to parse, or the `stateFileNotFound` failure.
 * @rejects Re-thrown `readFile` failure whose error code is not a
 *   recognized "missing file" code.
 */
async function readStateBytesAsync(
	deps: MigrateMantleStateDeps,
	readFile: (path: string) => Promise<Uint8Array>,
): Promise<Result<Uint8Array, MigrateError>> {
	if (deps.stateFileBytes !== undefined) {
		return { data: deps.stateFileBytes, success: true };
	}

	try {
		return { data: await readFile(deps.stateFilePath), success: true };
	} catch (err) {
		if (isFileMissing(err)) {
			return {
				err: { kind: "stateFileNotFound", path: deps.stateFilePath },
				success: false,
			};
		}

		throw err;
	}
}

const EMPTY_HASHES: ReadonlyMap<ResourceKey, Record<"en-us", Sha256Hex>> = new Map();

interface BuildStatesByEnvironmentInputs {
	readonly folds: ReadonlyMap<string, EnvironmentFoldResult>;
	readonly passHashesByEnvironment: ReadonlyMap<
		string,
		ReadonlyMap<ResourceKey, Record<"en-us", Sha256Hex>>
	>;
	readonly productHashesByEnvironment: ReadonlyMap<
		string,
		ReadonlyMap<ResourceKey, Record<"en-us", Sha256Hex>>
	>;
}

function buildStatesByEnvironment(
	inputs: BuildStatesByEnvironmentInputs,
): Readonly<Record<string, BedrockState>> {
	return Object.fromEntries(
		Array.from(inputs.folds, ([name, folded]): [string, BedrockState] => {
			return [
				name,
				buildState({
					environment: name,
					folded,
					passIconHashesByKey: inputs.passHashesByEnvironment.get(name) ?? EMPTY_HASHES,
					productIconHashesByKey:
						inputs.productHashesByEnvironment.get(name) ?? EMPTY_HASHES,
				}),
			];
		}),
	);
}

function prefixMantlePath(warning: MigrationWarning, environmentName: string): MigrationWarning {
	return { ...warning, mantlePath: `${environmentName}.${warning.mantlePath}` };
}

function collectFoldWarnings(
	folds: ReadonlyMap<string, EnvironmentFoldResult>,
): ReadonlyArray<MigrationWarning> {
	return [...folds].flatMap(([name, fold]) => {
		return fold.warnings.map((warning) => prefixMantlePath(warning, name));
	});
}

function buildReport(inputs: FinalizeReportInputs, validated: Config): MigrationReport {
	const {
		passHashesByEnvironment,
		productHashesByEnvironment,
		warnings: iconWarnings,
	} = inputs.iconRecomputation;
	const warnings = [
		...collectFoldWarnings(inputs.folds),
		...inputs.factorizeWarnings,
		...iconWarnings,
	];
	return {
		config: validated,
		configFileContent: serializeConfig({
			config: validated,
			configFormat: inputs.configFormat,
		}),
		statesByEnvironment: buildStatesByEnvironment({
			folds: inputs.folds,
			passHashesByEnvironment,
			productHashesByEnvironment,
		}),
		summary: summarizeWarnings(warnings),
		warnings,
	};
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

	return { data: buildReport(inputs, validated.data), success: true };
}

async function assembleReportAsync(
	inputs: AssembleReportInputs,
): Promise<Result<MigrationReport, MigrateError>> {
	const available = Object.keys(inputs.state.environments);
	const folds: ReadonlyMap<string, EnvironmentFoldResult> = new Map(
		available.map((name) => [name, foldEnvironment(inputs.state.environments[name] ?? [])]),
	);
	const factorized = factorizeEnvironments({
		folds,
		primaryEnvironment: inputs.primaryEnvironment,
	});
	if (!factorized.success) {
		return factorized;
	}

	const iconRecomputation = await recomputeIconHashesAsync({
		folds,
		readFile: inputs.readFile,
		stateFileDirectory: dirname(inputs.stateFilePath),
	});
	return finalizeReport({
		config: factorized.data.config,
		configFormat: inputs.configFormat,
		factorizeWarnings: factorized.data.warnings,
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
