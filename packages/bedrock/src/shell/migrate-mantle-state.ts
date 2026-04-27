import type { Result } from "@bedrock/ocale";

import { readFile as nodeReadFile } from "node:fs/promises";

import { buildState } from "../core/migrate/build-state.ts";
import { type EnvironmentFoldResult, foldEnvironment } from "../core/migrate/fold-environment.ts";
import type { MigrateError, MigrationReport } from "../core/migrate/migration-report.ts";
import { parseState } from "../core/migrate/parse-state.ts";
import { serializeConfig } from "../core/migrate/serialize-config.ts";
import type { MantleStateV6 } from "../core/migrate/types.ts";
import { type Config, validateConfig } from "../core/schema.ts";
import type { BedrockState } from "../core/state.ts";

const FILE_MISSING_CODES = new Set(["ENOENT"]);

/**
 * Inputs for `migrateMantleState`. The state file is read via
 * `readFile` (defaults to `node:fs/promises.readFile`) so callers can
 * inject in-memory fixtures from tests and the JSDoc `@example` block
 * stays self-contained.
 *
 * `outputFormat` is locked to `"typescript"` in v0.1; the YAML output
 * lands in a follow-up issue that widens the literal.
 */
export interface MigrateMantleStateDeps {
	/**
	 * Output format for the emitted bedrock config file. V0.1 ships
	 * TypeScript (`bedrock.config.ts` with `defineConfig({...})`).
	 */
	readonly outputFormat: "typescript";
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

/**
 * Read a Mantle state file and produce a `MigrationReport` containing a
 * bedrock config, per-environment `BedrockState`s, and a structured list
 * of fields that did not migrate verbatim.
 *
 * Skeleton: handles a single-environment, universe-only state. The
 * primary environment auto-picks when only one environment is present;
 * multi-environment inputs without an explicit `primaryEnvironment`
 * return `Err({ kind: "primaryEnvironmentRequired", available })` so the
 * migrator never silently picks a winner. Future slices fold game
 * passes, places, social links, and the deferred / blocked warning
 * categories.
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
 *     outputFormat: "typescript",
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

	return assembleReport(parsed.data, deps.primaryEnvironment);
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

function buildConfig(
	environmentNames: ReadonlyArray<string>,
	primaryFold: EnvironmentFoldResult | undefined,
): Config {
	const environments = Object.fromEntries(environmentNames.map((name) => [name, {}]));
	if (primaryFold?.universe === undefined) {
		return { environments };
	}

	return { environments, universe: primaryFold.universe.entry };
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

function finalizeReport(
	config: Config,
	folds: ReadonlyMap<string, EnvironmentFoldResult>,
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

	return {
		data: {
			config: validated.data,
			configFileContent: serializeConfig(validated.data),
			statesByEnvironment: buildStatesByEnvironment(folds),
			summary: { ambiguousCount: 0, blockedCount: 0, deferredCount: 0, interpretiveCount: 0 },
			warnings: [],
		},
		success: true,
	};
}

function assembleReport(
	state: MantleStateV6,
	primaryEnvironment: string | undefined,
): Result<MigrationReport, MigrateError> {
	const available = Object.keys(state.environments);
	const primaryResult = pickPrimary(available, primaryEnvironment);
	if (!primaryResult.success) {
		return primaryResult;
	}

	const folds: ReadonlyMap<string, EnvironmentFoldResult> = new Map(
		available.map((name) => [name, foldEnvironment(state.environments[name] ?? [])]),
	);
	return finalizeReport(buildConfig(available, folds.get(primaryResult.data)), folds);
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
