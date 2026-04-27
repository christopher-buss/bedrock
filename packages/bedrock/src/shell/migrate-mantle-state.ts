import type { Result } from "@bedrock/ocale";

import { readFile as nodeReadFile } from "node:fs/promises";

import type { MigrateError, MigrationReport } from "../core/migrate/migration-report.ts";
import { parseState } from "../core/migrate/parse-state.ts";
import type { MantleStateV6 } from "../core/migrate/types.ts";
import type { Config } from "../core/schema.ts";
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
 * Skeleton: returns a placeholder report whose `config` declares each
 * environment from the state file as an empty `EnvironmentEntry`, and
 * whose `statesByEnvironment` carries one empty `BedrockState` per
 * environment. Resource-folding, factorization, hash recomputation, and
 * TypeScript source emission ship in follow-up slices.
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
 *         expect(Object.keys(result.data.config.environments)).toStrictEqual([
 *             "production",
 *         ]);
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

	return {
		data: buildPlaceholderReport(parsed.data),
		success: true,
	};
}

function buildPlaceholderReport(state: MantleStateV6): MigrationReport {
	const environmentNames = Object.keys(state.environments);
	const config: Config = {
		environments: Object.fromEntries(environmentNames.map((name) => [name, {}])),
	};
	const statesByEnvironment: Readonly<Record<string, BedrockState>> = Object.fromEntries(
		environmentNames.map((name): [string, BedrockState] => [
			name,
			{ environment: name, resources: [], version: 1 },
		]),
	);

	return {
		config,
		configFileContent: "",
		statesByEnvironment,
		summary: { ambiguousCount: 0, blockedCount: 0, deferredCount: 0, interpretiveCount: 0 },
		warnings: [],
	};
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
