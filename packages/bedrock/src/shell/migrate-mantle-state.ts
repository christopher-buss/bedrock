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
import { type IconHashRecomputation, recomputeIconHashes } from "./recompute-icon-hashes.ts";

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
		[...inputs.folds.entries()].map(([name, folded]): [string, BedrockState] => {
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
	return [...folds.entries()].flatMap(([name, fold]) => {
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

async function assembleReport(
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

	const iconRecomputation = await recomputeIconHashes({
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
