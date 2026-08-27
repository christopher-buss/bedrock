import { fromAny } from "@total-typescript/shoehorn";

import { type } from "arktype";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { fakeClackPort } from "#tests/helpers/clack";
import { fakeMigratePromptPort } from "#tests/helpers/migrate-prompt-port";
import { fakeStateBackendPlugins, mergeStateBackendPlugins } from "#tests/helpers/plugins";
import type { MigrationReport } from "../../core/migrate/migration-report.ts";
import { EMPTY_PLUGIN_REGISTRY } from "../../core/plugin-registry.ts";
import type { Config } from "../../core/schema.ts";
import type { BedrockState, StateError } from "../../core/state.ts";
import type { StatePort } from "../../ports/state-port.ts";
import type { ProgDeps as ProgDependencies } from "../index.ts";
import { migrateCommand } from "./migrate.ts";

type ExitFunc = NonNullable<ProgDependencies["exit"]>;
type WriteFileFunc = NonNullable<ProgDependencies["writeFile"]>;
type MkdirFunc = NonNullable<ProgDependencies["mkdir"]>;
type MigrateFunc = NonNullable<ProgDependencies["migrateMantleState"]>;
type BuildStatePortFunc = NonNullable<ProgDependencies["buildStatePort"]>;

// Platform-correct expected paths the migrate command builds via `node:path`.
// On Windows these resolve with backslashes; on POSIX with forward slashes.
// The state-file input stays as a POSIX-style string because `dirname`
// preserves the separator the caller supplied; `join` does not.
const STATE_FILE_PATH = "/projects/example/.mantle-state.yml";
const CONFIG_TS_PATH = join("/projects/example", "bedrock.config.ts");
const CONFIG_YAML_PATH = join("/projects/example", "bedrock.config.yaml");
const REPORT_DIRECTORY = join("/projects/example", ".bedrock");
const REPORT_JSON_PATH = join(REPORT_DIRECTORY, "migration-report.json");
const REPORT_MD_PATH = join(REPORT_DIRECTORY, "migration-report.md");
const LOCAL_STATE_DIRECTORY = join(REPORT_DIRECTORY, "state");
const LOCAL_STATE_JSON_PATH = join(LOCAL_STATE_DIRECTORY, "production.json");

const SAMPLE_CONFIG: Config = {
	environments: { production: {} },
	universe: { universeId: "12345" },
};

const SAMPLE_STATE: BedrockState = { environment: "production", resources: [], version: 1 };

const SAMPLE_REPORT: MigrationReport = {
	config: SAMPLE_CONFIG,
	configFileContent: "",
	statesByEnvironment: { production: SAMPLE_STATE },
	summary: { ambiguousCount: 0, blockedCount: 0, deferredCount: 0, interpretiveCount: 0 },
	warnings: [],
};

function happyPort(write?: StatePort["write"]): StatePort {
	return {
		read: vi.fn<StatePort["read"]>(async () => ({ data: {}, success: true })),
		write: write ?? vi.fn<StatePort["write"]>(async () => ({ data: undefined, success: true })),
	};
}

function makeWriteSpy(): StatePort["write"] {
	const writeSpy = vi.fn<StatePort["write"]>();
	writeSpy.mockResolvedValue({ data: undefined, success: true });
	return writeSpy;
}

function happyPortResult(write?: StatePort["write"]): ReturnType<BuildStatePortFunc> {
	return { data: happyPort(write), success: true };
}

/**
 * A project loader answering with a config that declares no plugins,
 * which is what the command reads for a test stating nothing of its own
 * about plugin discovery.
 *
 * @returns The loader to inject.
 */
function fakeLoadProject(): NonNullable<ProgDependencies["loadProject"]> {
	return vi.fn<NonNullable<ProgDependencies["loadProject"]>>(async () => {
		return { data: { config: SAMPLE_CONFIG, plugins: EMPTY_PLUGIN_REGISTRY }, success: true };
	});
}

function makeDependencies(overrides: Partial<ProgDependencies> = {}): ProgDependencies {
	const migrate = vi.fn<MigrateFunc>();
	migrate.mockResolvedValue({ data: SAMPLE_REPORT, success: true });
	const writeFile = vi.fn<WriteFileFunc>();
	writeFile.mockResolvedValue();
	const mkdir = vi.fn<MkdirFunc>();
	mkdir.mockResolvedValue();
	return {
		buildStatePort: vi.fn<BuildStatePortFunc>(() => ({ data: happyPort(), success: true })),
		clack: fakeClackPort(),
		exit: vi.fn<ExitFunc>(),
		loadProject: fakeLoadProject(),
		migrateMantleState: migrate,
		migratePromptPort: fakeMigratePromptPort(),
		mkdir,
		writeFile,
		...overrides,
	};
}

function scriptHappyPrompts(dependencies: ProgDependencies): void {
	const port = dependencies.migratePromptPort;
	if (port === undefined) {
		throw new Error("migratePromptPort missing in deps");
	}

	vi.mocked(port.promptStateFilePath).mockResolvedValueOnce({
		data: "./.mantle-state.yml",
		success: true,
	});
	vi.mocked(port.promptConfigFormat).mockResolvedValueOnce({ data: "typescript", success: true });
	vi.mocked(port.promptStateBackend).mockResolvedValueOnce({ data: "gist", success: true });
	vi.mocked(port.promptGistId).mockResolvedValueOnce({ data: "abc123", success: true });
}

describe(migrateCommand, () => {
	it("should prompt for the migration source when --from is omitted", async () => {
		expect.assertions(3);

		const dependencies = makeDependencies();
		scriptHappyPrompts(dependencies);
		vi.mocked(dependencies.migratePromptPort!.promptMigrationSource).mockResolvedValueOnce({
			data: "mantle",
			success: true,
		});

		await migrateCommand(dependencies)("./.mantle-state.yml", {});

		expect(
			dependencies.migratePromptPort!.promptMigrationSource,
		).toHaveBeenCalledExactlyOnceWith(["mantle"]);
		expect(dependencies.migrateMantleState).toHaveBeenCalledExactlyOnceWith({
			configFormat: "typescript",
			stateFilePath: "./.mantle-state.yml",
		});
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should cancel cleanly when the user aborts the migration-source prompt", async () => {
		expect.assertions(2);

		const dependencies = makeDependencies();
		vi.mocked(dependencies.migratePromptPort!.promptMigrationSource).mockResolvedValueOnce({
			err: { kind: "cancelled" },
			success: false,
		});

		await migrateCommand(dependencies)("./.mantle-state.yml", {});

		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("migrate cancelled");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should reject an unknown --from source with the unknownSource diagnostic", async () => {
		expect.assertions(2);

		const dependencies = makeDependencies();

		await migrateCommand(dependencies)(undefined, { from: "universe" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			"unknown migration source 'universe' (supported: mantle)",
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should call the migrator once with the picked format and resolved path", async () => {
		expect.assertions(3);

		const dependencies = makeDependencies();
		scriptHappyPrompts(dependencies);

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(dependencies.clack!.intro).toHaveBeenCalledExactlyOnceWith("bedrock migrate");
		expect(dependencies.migrateMantleState).toHaveBeenCalledExactlyOnceWith({
			configFormat: "typescript",
			stateFilePath: STATE_FILE_PATH,
		});

		const firstCallDependencies = vi.mocked(dependencies.migrateMantleState!).mock.calls[0]![0];

		expect(Object.hasOwn(firstCallDependencies, "primaryEnvironment")).toBeFalse();
	});

	it("should write each environment's state through the StatePort and log per-env success", async () => {
		expect.assertions(3);

		const writeSpy = makeWriteSpy();
		const buildStatePort = vi.fn<BuildStatePortFunc>(() => happyPortResult(writeSpy));
		const dependencies = makeDependencies({ buildStatePort });
		scriptHappyPrompts(dependencies);

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(writeSpy).toHaveBeenCalledExactlyOnceWith(SAMPLE_STATE);
		expect(dependencies.clack!.logSuccess).toHaveBeenCalledWith(
			"production: 0 resources migrated",
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should write the bedrock config beside the state file and log the path", async () => {
		expect.assertions(3);

		const writeFile = vi.fn<WriteFileFunc>();
		writeFile.mockResolvedValue();
		const dependencies = makeDependencies({ writeFile });
		scriptHappyPrompts(dependencies);

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		const configWrites = vi
			.mocked(writeFile)
			.mock.calls.filter(([path]) => path === CONFIG_TS_PATH);

		expect(configWrites).toStrictEqual([[CONFIG_TS_PATH, expect.any(String)]]);
		expect(dependencies.clack!.logSuccess).toHaveBeenCalledWith(`wrote ${CONFIG_TS_PATH}`);
		expect(dependencies.clack!.outro).toHaveBeenCalledExactlyOnceWith("migrate succeeded");
	});

	it("should write the migration report json and markdown alongside the state files", async () => {
		expect.assertions(3);

		const writeFile = vi.fn<WriteFileFunc>();
		writeFile.mockResolvedValue();
		const mkdir = vi.fn<MkdirFunc>();
		mkdir.mockResolvedValue();
		const dependencies = makeDependencies({ mkdir, writeFile });
		scriptHappyPrompts(dependencies);

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(mkdir).toHaveBeenCalledWith(REPORT_DIRECTORY);
		expect(writeFile).toHaveBeenCalledWith(
			REPORT_JSON_PATH,
			expect.stringContaining('"summary"'),
		);
		expect(writeFile).toHaveBeenCalledWith(
			REPORT_MD_PATH,
			expect.stringContaining("# Migration report"),
		);
	});

	it("should render an error and exit 1 when the report directory mkdir rejects", async () => {
		expect.assertions(3);

		const mkdir = vi.fn<MkdirFunc>();
		// First call (writeMigratedStates is gist-backend so doesn't mkdir)
		// goes to the migration-report directory.
		mkdir.mockRejectedValueOnce(new Error("EACCES: permission denied"));
		const dependencies = makeDependencies({ mkdir });
		scriptHappyPrompts(dependencies);

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			`migration report directory create failed (${REPORT_DIRECTORY}): EACCES: permission denied`,
		);
		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("migrate failed");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should render an error and exit 1 when the migration report json write rejects", async () => {
		expect.assertions(3);

		// First write is the bedrock config; second is migration-report.json.
		const writeFile = vi
			.fn<WriteFileFunc>()
			.mockResolvedValueOnce()
			.mockRejectedValueOnce(new Error("EROFS: read-only file system"));
		const dependencies = makeDependencies({ writeFile });
		scriptHappyPrompts(dependencies);

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			`migration report write failed (${REPORT_JSON_PATH}): EROFS: read-only file system`,
		);
		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("migrate failed");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should render an error and exit 1 when the migration report markdown write rejects", async () => {
		expect.assertions(3);

		// 1: bedrock config (ok). 2: migration-report.json (ok). 3: .md (reject).
		const writeFile = vi
			.fn<WriteFileFunc>()
			.mockResolvedValueOnce()
			.mockResolvedValueOnce()
			.mockRejectedValueOnce(new Error("ENOSPC: no space left on device"));
		const dependencies = makeDependencies({ writeFile });
		scriptHappyPrompts(dependencies);

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			`migration report write failed (${REPORT_MD_PATH}): ENOSPC: no space left on device`,
		);
		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("migrate failed");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should pass process.env through getEnv when constructing the StatePort", async () => {
		expect.assertions(1);

		onTestFinished(() => {
			vi.unstubAllEnvs();
		});
		vi.stubEnv("BEDROCK_GITHUB_TOKEN", "from-process");

		const buildStatePort = vi.fn<BuildStatePortFunc>(() => happyPortResult());
		const dependencies = makeDependencies({ buildStatePort });
		scriptHappyPrompts(dependencies);

		await migrateCommand(dependencies)("./.mantle-state.yml", { from: "mantle" });

		const firstCall = vi.mocked(buildStatePort).mock.calls[0]![0];

		expect(firstCall.getEnv("BEDROCK_GITHUB_TOKEN")).toBe("from-process");
	});

	it("should render an io error and exit 1 when the migrator throws (e.g. EACCES)", async () => {
		expect.assertions(3);

		const migrateMantleState = vi.fn<MigrateFunc>(async () => {
			throw new Error("EACCES: permission denied");
		});
		const dependencies = makeDependencies({ migrateMantleState });
		scriptHappyPrompts(dependencies);

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			`failed to read Mantle state file '${STATE_FILE_PATH}': EACCES: permission denied`,
		);
		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("migrate failed");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should describe a non-Error throw value via String(value)", async () => {
		expect.assertions(1);

		const migrateMantleState = vi.fn<MigrateFunc>();
		migrateMantleState.mockRejectedValueOnce("raw-string-failure");
		const dependencies = makeDependencies({ migrateMantleState });
		scriptHappyPrompts(dependencies);

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			`failed to read Mantle state file '${STATE_FILE_PATH}': raw-string-failure`,
		);
	});

	it("should render an io error from the second migrator pass (multi-env retry)", async () => {
		expect.assertions(2);

		const migrateMantleState = vi
			.fn<MigrateFunc>()
			.mockResolvedValueOnce({
				err: { available: ["production", "staging"], kind: "primaryEnvironmentRequired" },
				success: false,
			})
			.mockRejectedValueOnce(new Error("ENOSPC: no space left on device"));
		const dependencies = makeDependencies({ migrateMantleState });
		scriptHappyPrompts(dependencies);
		vi.mocked(dependencies.migratePromptPort!.promptPrimaryEnvironment).mockResolvedValueOnce({
			data: "production",
			success: true,
		});

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			`failed to read Mantle state file '${STATE_FILE_PATH}': ENOSPC: no space left on device`,
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should render a config-write error and exit 1 when writeFile rejects", async () => {
		expect.assertions(3);

		const writeFile = vi.fn<WriteFileFunc>();
		writeFile.mockRejectedValueOnce(new Error("EROFS: read-only file system"));
		const dependencies = makeDependencies({ writeFile });
		scriptHappyPrompts(dependencies);

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			`config file write failed (${CONFIG_TS_PATH}): EROFS: read-only file system`,
		);
		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("migrate failed");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should fall back to clack.text when the positional path is omitted", async () => {
		expect.assertions(2);

		const dependencies = makeDependencies();
		scriptHappyPrompts(dependencies);

		await migrateCommand(dependencies)(undefined, { from: "mantle" });

		expect(
			dependencies.migratePromptPort!.promptStateFilePath,
		).toHaveBeenCalledExactlyOnceWith();
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should re-run the migrator with the picked primary env on multi-env state", async () => {
		expect.assertions(3);

		const migrateMantleState = vi
			.fn<MigrateFunc>()
			.mockResolvedValueOnce({
				err: { available: ["production", "staging"], kind: "primaryEnvironmentRequired" },
				success: false,
			})
			.mockResolvedValueOnce({ data: SAMPLE_REPORT, success: true });
		const dependencies = makeDependencies({ migrateMantleState });
		scriptHappyPrompts(dependencies);
		vi.mocked(dependencies.migratePromptPort!.promptPrimaryEnvironment).mockResolvedValueOnce({
			data: "production",
			success: true,
		});

		await migrateCommand(dependencies)("./.mantle-state.yml", { from: "mantle" });

		expect(migrateMantleState).toHaveBeenCalledTimes(2);
		expect(migrateMantleState).toHaveBeenLastCalledWith(
			expect.objectContaining({ primaryEnvironment: "production" }),
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should render the migrator error and exit 1 on a non-recoverable failure", async () => {
		expect.assertions(3);

		const migrateMantleState = vi.fn<MigrateFunc>(async () => {
			return {
				err: { kind: "stateFileNotFound", path: "./.mantle-state.yml" },
				success: false,
			};
		});
		const dependencies = makeDependencies({ migrateMantleState });
		scriptHappyPrompts(dependencies);

		await migrateCommand(dependencies)("./.mantle-state.yml", { from: "mantle" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			"Mantle state file not found at './.mantle-state.yml'",
		);
		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("migrate failed");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should render the migrator error from the second pass when re-runs fail", async () => {
		expect.assertions(2);

		const migrateMantleState = vi
			.fn<MigrateFunc>()
			.mockResolvedValueOnce({
				err: { available: ["production", "staging"], kind: "primaryEnvironmentRequired" },
				success: false,
			})
			.mockResolvedValueOnce({
				err: {
					available: ["production", "staging"],
					kind: "primaryEnvironmentNotFound",
					primary: "ghost",
				},
				success: false,
			});
		const dependencies = makeDependencies({ migrateMantleState });
		scriptHappyPrompts(dependencies);
		vi.mocked(dependencies.migratePromptPort!.promptPrimaryEnvironment).mockResolvedValueOnce({
			data: "ghost",
			success: true,
		});

		await migrateCommand(dependencies)("./.mantle-state.yml", { from: "mantle" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			"primary environment 'ghost' not found (available: production, staging)",
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should render the buildStatePort error when constructing the StatePort fails", async () => {
		expect.assertions(2);

		const buildStatePort = vi.fn<BuildStatePortFunc>(() => {
			return {
				err: {
					kind: "missingCredential",
					purpose: "stateBackend",
					variable: "BEDROCK_GITHUB_TOKEN",
				},
				success: false,
			};
		});
		const dependencies = makeDependencies({ buildStatePort });
		scriptHappyPrompts(dependencies);

		await migrateCommand(dependencies)("./.mantle-state.yml", { from: "mantle" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			"missing credential: environment variable BEDROCK_GITHUB_TOKEN is not set",
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should render the unsupportedBackend error from buildStatePort", async () => {
		expect.assertions(1);

		const buildStatePort = vi.fn<BuildStatePortFunc>(() => {
			return {
				err: { backend: "s3", hint: "pass a custom statePort", kind: "unsupportedBackend" },
				success: false,
			};
		});
		const dependencies = makeDependencies({ buildStatePort });
		scriptHappyPrompts(dependencies);

		await migrateCommand(dependencies)("./.mantle-state.yml", { from: "mantle" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			"unsupported state backend 's3' (pass a custom statePort)",
		);
	});

	it("should render the state-write error and exit 1 when statePort.write fails", async () => {
		expect.assertions(2);

		const stateError: StateError = {
			file: "state.json",
			kind: "stateError",
			reason: "auth 401",
		};
		const writeSpy: StatePort["write"] = vi
			.fn<StatePort["write"]>()
			.mockResolvedValueOnce({ err: stateError, success: false });
		const buildStatePort = vi.fn<BuildStatePortFunc>(() => {
			return { data: happyPort(writeSpy), success: true };
		});
		const dependencies = makeDependencies({ buildStatePort });
		scriptHappyPrompts(dependencies);

		await migrateCommand(dependencies)("./.mantle-state.yml", { from: "mantle" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			"state write failed for 'production' (state.json): auth 401",
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should cancel cleanly when the user aborts the config-format prompt", async () => {
		expect.assertions(2);

		const dependencies = makeDependencies();
		scriptHappyPrompts(dependencies);
		vi.mocked(dependencies.migratePromptPort!.promptConfigFormat).mockReset();
		vi.mocked(dependencies.migratePromptPort!.promptConfigFormat).mockResolvedValueOnce({
			err: { kind: "cancelled" },
			success: false,
		});

		await migrateCommand(dependencies)("./.mantle-state.yml", { from: "mantle" });

		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("migrate cancelled");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should cancel cleanly when the user aborts the state-backend prompt", async () => {
		expect.assertions(2);

		const dependencies = makeDependencies();
		scriptHappyPrompts(dependencies);
		vi.mocked(dependencies.migratePromptPort!.promptStateBackend).mockReset();
		vi.mocked(dependencies.migratePromptPort!.promptStateBackend).mockResolvedValueOnce({
			err: { kind: "cancelled" },
			success: false,
		});

		await migrateCommand(dependencies)("./.mantle-state.yml", { from: "mantle" });

		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("migrate cancelled");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should cancel cleanly when the user aborts the gist-id prompt", async () => {
		expect.assertions(2);

		const dependencies = makeDependencies();
		scriptHappyPrompts(dependencies);
		vi.mocked(dependencies.migratePromptPort!.promptGistId).mockReset();
		vi.mocked(dependencies.migratePromptPort!.promptGistId).mockResolvedValueOnce({
			err: { kind: "cancelled" },
			success: false,
		});

		await migrateCommand(dependencies)("./.mantle-state.yml", { from: "mantle" });

		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("migrate cancelled");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should cancel cleanly when the user aborts the path prompt", async () => {
		expect.assertions(2);

		const dependencies = makeDependencies();
		vi.mocked(dependencies.migratePromptPort!.promptStateFilePath).mockResolvedValueOnce({
			err: { kind: "cancelled" },
			success: false,
		});

		await migrateCommand(dependencies)(undefined, { from: "mantle" });

		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("migrate cancelled");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should cancel cleanly when the user aborts the primary-env prompt", async () => {
		expect.assertions(1);

		const migrateMantleState = vi.fn<MigrateFunc>(async () => {
			return {
				err: { available: ["production", "staging"], kind: "primaryEnvironmentRequired" },
				success: false,
			};
		});
		const dependencies = makeDependencies({ migrateMantleState });
		scriptHappyPrompts(dependencies);
		vi.mocked(dependencies.migratePromptPort!.promptPrimaryEnvironment).mockResolvedValueOnce({
			err: { kind: "cancelled" },
			success: false,
		});

		await migrateCommand(dependencies)("./.mantle-state.yml", { from: "mantle" });

		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("migrate cancelled");
	});

	it("should stay silent in the summary when every warning count is zero", async () => {
		expect.assertions(2);

		const dependencies = makeDependencies();
		scriptHappyPrompts(dependencies);

		await migrateCommand(dependencies)("./.mantle-state.yml", { from: "mantle" });

		expect(dependencies.clack!.logError).not.toHaveBeenCalled();
		// logSuccess fires for state and config writes; assert only that the
		// review-prompt success line does not.
		expect(dependencies.clack!.logSuccess).not.toHaveBeenCalledWith(
			expect.stringContaining("auto-mapped or skipped fields"),
		);
	});

	it("should emit an action-required error line when ambiguous warnings exist", async () => {
		expect.assertions(2);

		const reportWithAmbiguous: MigrationReport = {
			...SAMPLE_REPORT,
			summary: {
				ambiguousCount: 4,
				blockedCount: 3,
				deferredCount: 2,
				interpretiveCount: 1,
			},
		};
		const migrateMantleState = vi.fn<MigrateFunc>(async () => {
			return { data: reportWithAmbiguous, success: true };
		});
		const dependencies = makeDependencies({ migrateMantleState });
		scriptHappyPrompts(dependencies);

		await migrateCommand(dependencies)("./.mantle-state.yml", { from: "mantle" });

		expect(dependencies.clack!.logError).toHaveBeenCalledWith(
			expect.stringMatching(
				/^action required: 4 fields need your input\. See .*\.bedrock[\\/]migration-report\.md$/,
			),
		);
		// Auto-mapped success line should not fire when ambiguous > 0.
		expect(dependencies.clack!.logSuccess).not.toHaveBeenCalledWith(
			expect.stringContaining("auto-mapped or skipped fields"),
		);
	});

	it("should emit a review-needed success line when only non-ambiguous warnings exist", async () => {
		expect.assertions(2);

		const reportWithoutAmbiguous: MigrationReport = {
			...SAMPLE_REPORT,
			summary: {
				ambiguousCount: 0,
				blockedCount: 3,
				deferredCount: 2,
				interpretiveCount: 1,
			},
		};
		const migrateMantleState = vi.fn<MigrateFunc>(async () => {
			return { data: reportWithoutAmbiguous, success: true };
		});
		const dependencies = makeDependencies({ migrateMantleState });
		scriptHappyPrompts(dependencies);

		await migrateCommand(dependencies)("./.mantle-state.yml", { from: "mantle" });

		expect(dependencies.clack!.logSuccess).toHaveBeenCalledWith(
			expect.stringMatching(
				/^migration complete; see .*\.bedrock[\\/]migration-report\.md for 6 auto-mapped or skipped fields$/,
			),
		);
		expect(dependencies.clack!.logError).not.toHaveBeenCalled();
	});

	function s3Plugins(): NonNullable<ProgDependencies["plugins"]> {
		return fakeStateBackendPlugins({
			name: "s3",
			createPort: () => ({ data: happyPort(), success: true }),
			migratePrompts: [
				{ key: "bucket", label: "Bucket name?", placeholder: "my-bucket" },
				{ key: "region", label: "Region?", placeholder: "eu-west-2" },
				{
					key: "endpoint",
					condition: (answers) => answers["region"] === "custom",
					label: "Endpoint override?",
				},
			],
			schema: type({ "bucket": "string > 0", "region?": "string" }),
			specifier: "@example/state-s3",
		});
	}

	function scriptPluginBackendPrompts(dependencies: ProgDependencies): void {
		const port = dependencies.migratePromptPort!;
		vi.mocked(port.promptStateFilePath).mockResolvedValueOnce({
			data: STATE_FILE_PATH,
			success: true,
		});
		vi.mocked(port.promptConfigFormat).mockResolvedValueOnce({
			data: "typescript",
			success: true,
		});
		vi.mocked(port.promptStateBackend).mockResolvedValueOnce({ data: "s3", success: true });
		vi.mocked(port.promptBackendField)
			.mockResolvedValueOnce({ data: "my-bucket", success: true })
			.mockResolvedValueOnce({ data: "eu-west-2", success: true });
	}

	function s3PluginsWithSource(
		readBytes: NonNullable<
			Parameters<typeof fakeStateBackendPlugins>[0]["migrateSource"]
		>["readBytes"],
	): NonNullable<ProgDependencies["plugins"]> {
		return fakeStateBackendPlugins({
			name: "s3",
			createPort: () => ({ data: happyPort(), success: true }),
			migratePrompts: [{ key: "bucket", label: "Bucket name?" }],
			migrateSource: {
				prompts: [{ key: "objectKey", label: "Object key of the Mantle state?" }],
				readBytes,
			},
			schema: type({ bucket: "string > 0" }),
			specifier: "@example/state-s3",
		});
	}

	it("should offer a plugin that can fetch the previous tool's state when no path was given", async () => {
		expect.assertions(1);

		const dependencies = makeDependencies({
			plugins: s3PluginsWithSource(async () => ({ data: Uint8Array.of(0), success: true })),
		});
		const port = dependencies.migratePromptPort!;
		vi.mocked(port.promptStateSource).mockResolvedValueOnce({
			err: { kind: "cancelled" },
			success: false,
		});

		await migrateCommand(dependencies)(undefined, { from: "mantle" });

		expect(port.promptStateSource).toHaveBeenCalledExactlyOnceWith(["s3"]);
	});

	it("should migrate the bytes a plugin fetched from the coordinates it asked for", async () => {
		expect.assertions(2);

		const encoder = new TextEncoder();
		const bytes = encoder.encode("version: '6'\n");
		const seen: Array<unknown> = [];
		process.env["BEDROCK_TEST_REGION"] = "eu-west-2";
		onTestFinished(() => {
			delete process.env["BEDROCK_TEST_REGION"];
		});
		const dependencies = makeDependencies({
			plugins: s3PluginsWithSource(async ({ coordinates, getEnv }) => {
				seen.push(coordinates, getEnv("BEDROCK_TEST_REGION"));
				return { data: bytes, success: true };
			}),
		});
		const port = dependencies.migratePromptPort!;
		vi.mocked(port.promptStateSource).mockResolvedValueOnce({ data: "s3", success: true });
		vi.mocked(port.promptBackendField)
			.mockResolvedValueOnce({ data: "state/mantle.yml", success: true })
			.mockResolvedValueOnce({ data: "my-bucket", success: true });
		vi.mocked(port.promptConfigFormat).mockResolvedValueOnce({
			data: "typescript",
			success: true,
		});
		vi.mocked(port.promptStateBackend).mockResolvedValueOnce({ data: "s3", success: true });

		await migrateCommand(dependencies)(undefined, { from: "mantle" });

		expect(seen).toStrictEqual([{ objectKey: "state/mantle.yml" }, "eu-west-2"]);
		expect(dependencies.migrateMantleState).toHaveBeenCalledWith(
			expect.objectContaining({ stateFileBytes: bytes }),
		);
	});

	it("should report a plugin that could not fetch the previous tool's state", async () => {
		expect.assertions(2);

		const dependencies = makeDependencies({
			plugins: s3PluginsWithSource(async () => {
				return {
					err: { reason: "no such object" },
					success: false,
				};
			}),
		});
		const port = dependencies.migratePromptPort!;
		vi.mocked(port.promptStateSource).mockResolvedValueOnce({ data: "s3", success: true });
		vi.mocked(port.promptBackendField).mockResolvedValueOnce({
			data: "state/mantle.yml",
			success: true,
		});

		await migrateCommand(dependencies)(undefined, { from: "mantle" });

		expect(dependencies.clack!.logError).toHaveBeenCalledWith(
			"plugin '@example/state-s3' could not read the mantle state: no such object",
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should ask nothing for a plugin backend that declared no fields", async () => {
		expect.assertions(1);

		const writeFile = vi.fn<WriteFileFunc>();
		writeFile.mockResolvedValue();
		const dependencies = makeDependencies({
			plugins: fakeStateBackendPlugins({
				name: "s3",
				createPort: () => ({ data: happyPort(), success: true }),
				schema: type({}),
				specifier: "@example/state-s3",
			}),
			writeFile,
		});
		const port = dependencies.migratePromptPort!;
		vi.mocked(port.promptStateFilePath).mockResolvedValueOnce({
			data: STATE_FILE_PATH,
			success: true,
		});
		vi.mocked(port.promptConfigFormat).mockResolvedValueOnce({
			data: "typescript",
			success: true,
		});
		vi.mocked(port.promptStateBackend).mockResolvedValueOnce({ data: "s3", success: true });

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(port.promptBackendField).not.toHaveBeenCalled();
	});

	it("should record an answer under a key that names an object built-in", async () => {
		expect.assertions(1);

		const buildStatePort = vi.fn<BuildStatePortFunc>(() => happyPortResult());
		const dependencies = makeDependencies({
			buildStatePort,
			plugins: fakeStateBackendPlugins({
				name: "s3",
				createPort: () => ({ data: happyPort(), success: true }),
				migratePrompts: [{ key: "__proto__", label: "Prototype?" }],
				schema: type({}),
				specifier: "@example/state-s3",
			}),
		});
		const port = dependencies.migratePromptPort!;
		vi.mocked(port.promptStateFilePath).mockResolvedValueOnce({
			data: STATE_FILE_PATH,
			success: true,
		});
		vi.mocked(port.promptConfigFormat).mockResolvedValueOnce({
			data: "typescript",
			success: true,
		});
		vi.mocked(port.promptStateBackend).mockResolvedValueOnce({ data: "s3", success: true });
		vi.mocked(port.promptBackendField).mockResolvedValueOnce({
			data: "polluted",
			success: true,
		});

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(
			buildStatePort.mock.calls.map(([deps]) => Object.entries(deps.stateConfig)),
		).toStrictEqual([
			[
				["__proto__", "polluted"],
				["backend", "s3"],
			],
		]);
	});

	it("should cancel when the user aborts a plugin backend's field prompt", async () => {
		expect.assertions(2);

		const dependencies = makeDependencies({ plugins: s3Plugins() });
		const port = dependencies.migratePromptPort!;
		vi.mocked(port.promptStateFilePath).mockResolvedValueOnce({
			data: STATE_FILE_PATH,
			success: true,
		});
		vi.mocked(port.promptConfigFormat).mockResolvedValueOnce({
			data: "typescript",
			success: true,
		});
		vi.mocked(port.promptStateBackend).mockResolvedValueOnce({ data: "s3", success: true });
		vi.mocked(port.promptBackendField).mockResolvedValueOnce({
			err: { kind: "cancelled" },
			success: false,
		});

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("migrate cancelled");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should fall back to the local state file when the source picker names no fetching backend", async () => {
		expect.assertions(1);

		const dependencies = makeDependencies({
			plugins: s3PluginsWithSource(async () => ({ data: Uint8Array.of(0), success: true })),
		});
		const port = dependencies.migratePromptPort!;
		vi.mocked(port.promptStateSource).mockResolvedValueOnce({ data: "local", success: true });
		vi.mocked(port.promptStateFilePath).mockResolvedValueOnce({
			data: STATE_FILE_PATH,
			success: true,
		});
		vi.mocked(port.promptConfigFormat).mockResolvedValueOnce({
			data: "typescript",
			success: true,
		});
		vi.mocked(port.promptStateBackend).mockResolvedValueOnce({ data: "local", success: true });

		await migrateCommand(dependencies)(undefined, { from: "mantle" });

		expect(vi.mocked(dependencies.migrateMantleState!).mock.calls).toStrictEqual([
			[{ configFormat: "typescript", stateFilePath: STATE_FILE_PATH }],
		]);
	});

	it("should cancel when the user aborts the local state-file prompt", async () => {
		expect.assertions(2);

		const dependencies = makeDependencies({
			plugins: s3PluginsWithSource(async () => ({ data: Uint8Array.of(0), success: true })),
		});
		const port = dependencies.migratePromptPort!;
		vi.mocked(port.promptStateSource).mockResolvedValueOnce({ data: "local", success: true });
		vi.mocked(port.promptStateFilePath).mockResolvedValueOnce({
			err: { kind: "cancelled" },
			success: false,
		});

		await migrateCommand(dependencies)(undefined, { from: "mantle" });

		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("migrate cancelled");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should cancel when the user aborts a plugin's source coordinate prompt", async () => {
		expect.assertions(2);

		const dependencies = makeDependencies({
			plugins: s3PluginsWithSource(async () => ({ data: Uint8Array.of(0), success: true })),
		});
		const port = dependencies.migratePromptPort!;
		vi.mocked(port.promptStateSource).mockResolvedValueOnce({ data: "s3", success: true });
		vi.mocked(port.promptBackendField).mockResolvedValueOnce({
			err: { kind: "cancelled" },
			success: false,
		});

		await migrateCommand(dependencies)(undefined, { from: "mantle" });

		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("migrate cancelled");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should report a plugin whose fetch threw instead of letting the rejection escape", async () => {
		expect.assertions(2);

		const dependencies = makeDependencies({
			plugins: s3PluginsWithSource(async () => {
				throw new Error("socket hang up");
			}),
		});
		const port = dependencies.migratePromptPort!;
		vi.mocked(port.promptStateSource).mockResolvedValueOnce({ data: "s3", success: true });
		vi.mocked(port.promptBackendField).mockResolvedValueOnce({
			data: "state/mantle.yml",
			success: true,
		});

		await migrateCommand(dependencies)(undefined, { from: "mantle" });

		expect(dependencies.clack!.logError).toHaveBeenCalledWith(
			"plugin '@example/state-s3' could not read the mantle state: socket hang up",
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should take its plugin backends from the project config when none were injected", async () => {
		expect.assertions(1);

		const plugins = s3Plugins();
		const dependencies = makeDependencies({
			loadProject: vi.fn<NonNullable<ProgDependencies["loadProject"]>>(async () => {
				return {
					data: { config: SAMPLE_CONFIG, plugins },
					success: true,
				};
			}),
		});
		scriptPluginBackendPrompts(dependencies);

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(dependencies.migratePromptPort!.promptStateBackend).toHaveBeenCalledExactlyOnceWith([
			"s3",
		]);
	});

	it("should report a plugin the project config could not load rather than quietly dropping it", async () => {
		expect.assertions(2);

		const dependencies = makeDependencies({
			loadProject: vi.fn<NonNullable<ProgDependencies["loadProject"]>>(async () => {
				return {
					err: {
						kind: "pluginLoadFailed",
						message: "Cannot find package '@example/state-s3'",
						reason: "notInstalled",
						specifier: "@example/state-s3",
					},
					success: false,
				};
			}),
		});

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(dependencies.clack!.logError).toHaveBeenCalledWith(
			expect.stringContaining("@example/state-s3"),
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should search for the project config from the project root the command was given", async () => {
		expect.assertions(1);

		const loadProject = vi.fn<NonNullable<ProgDependencies["loadProject"]>>(async () => {
			return {
				data: { config: SAMPLE_CONFIG, plugins: s3Plugins() },
				success: true,
			};
		});
		const dependencies = makeDependencies({ loadProject, projectRoot: "/projects/example" });
		scriptPluginBackendPrompts(dependencies);

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(loadProject).toHaveBeenCalledExactlyOnceWith({ cwd: "/projects/example" });
	});

	it("should search for the project config from the working directory when given no project root", async () => {
		expect.assertions(1);

		const loadProject = fakeLoadProject();
		const dependencies = makeDependencies({ loadProject });
		scriptHappyPrompts(dependencies);

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(loadProject).toHaveBeenCalledExactlyOnceWith({ cwd: process.cwd() });
	});

	it("should offer no plugin backends when the project has no config to load", async () => {
		expect.assertions(1);

		const dependencies = makeDependencies({
			loadProject: vi.fn<NonNullable<ProgDependencies["loadProject"]>>(async () => {
				return {
					err: { kind: "fileNotFound", searchedFrom: "/projects/example" },
					success: false,
				};
			}),
		});
		scriptHappyPrompts(dependencies);

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(dependencies.migratePromptPort!.promptStateBackend).toHaveBeenCalledExactlyOnceWith(
			[],
		);
	});

	it("should offer a plugin-declared backend alongside the builtins when picking where state lives", async () => {
		expect.assertions(1);

		const dependencies = makeDependencies({ plugins: s3Plugins() });
		scriptPluginBackendPrompts(dependencies);

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(dependencies.migratePromptPort!.promptStateBackend).toHaveBeenCalledExactlyOnceWith([
			"s3",
		]);
	});

	it("should build the gist state port from the gist id the user gave", async () => {
		expect.assertions(1);

		const buildStatePort = vi.fn<BuildStatePortFunc>(() => happyPortResult());
		const dependencies = makeDependencies({ buildStatePort });
		scriptHappyPrompts(dependencies);

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(buildStatePort.mock.calls.map(([deps]) => deps.stateConfig)).toStrictEqual([
			{ backend: "gist", gistId: "abc123" },
		]);
	});

	it("should offer only the backends whose plugin declared what to ask for", async () => {
		expect.assertions(1);

		const dependencies = makeDependencies({
			plugins: mergeStateBackendPlugins(
				s3Plugins(),
				fakeStateBackendPlugins({
					name: "gcs",
					createPort: () => ({ err: { reason: "unused" }, success: false }),
					schema: type({ bucket: "string > 0" }),
					specifier: "@example/state-gcs",
				}),
			),
		});
		scriptPluginBackendPrompts(dependencies);

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(dependencies.migratePromptPort!.promptStateBackend).toHaveBeenCalledExactlyOnceWith([
			"s3",
		]);
	});

	it("should offer only the backends whose plugin can fetch the previous tool's state", async () => {
		expect.assertions(1);

		const dependencies = makeDependencies({
			plugins: mergeStateBackendPlugins(
				s3PluginsWithSource(async () => ({ data: Uint8Array.of(0), success: true })),
				fakeStateBackendPlugins({
					name: "gcs",
					createPort: () => ({ err: { reason: "unused" }, success: false }),
					migratePrompts: [],
					schema: type({ bucket: "string > 0" }),
					specifier: "@example/state-gcs",
				}),
			),
		});
		const port = dependencies.migratePromptPort!;
		vi.mocked(port.promptStateSource).mockResolvedValueOnce({
			err: { kind: "cancelled" },
			success: false,
		});

		await migrateCommand(dependencies)(undefined, { from: "mantle" });

		expect(port.promptStateSource).toHaveBeenCalledExactlyOnceWith(["s3"]);
	});

	it("should ask a plugin backend's declared fields in the declared order, skipping one whose condition is unmet", async () => {
		expect.assertions(1);

		const dependencies = makeDependencies({ plugins: s3Plugins() });
		scriptPluginBackendPrompts(dependencies);

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(
			vi
				.mocked(dependencies.migratePromptPort!.promptBackendField)
				.mock.calls.map(([field]) => field.label),
		).toStrictEqual(["Bucket name?", "Region?"]);
	});

	it("should ask a conditional field once its condition holds", async () => {
		expect.assertions(1);

		const dependencies = makeDependencies({ plugins: s3Plugins() });
		const port = dependencies.migratePromptPort!;
		vi.mocked(port.promptStateFilePath).mockResolvedValueOnce({
			data: STATE_FILE_PATH,
			success: true,
		});
		vi.mocked(port.promptConfigFormat).mockResolvedValueOnce({
			data: "typescript",
			success: true,
		});
		vi.mocked(port.promptStateBackend).mockResolvedValueOnce({ data: "s3", success: true });
		vi.mocked(port.promptBackendField)
			.mockResolvedValueOnce({ data: "my-bucket", success: true })
			.mockResolvedValueOnce({ data: "custom", success: true })
			.mockResolvedValueOnce({ data: "https://s3.example.com", success: true });

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(
			vi.mocked(port.promptBackendField).mock.calls.map(([field]) => field.label),
		).toStrictEqual(["Bucket name?", "Region?", "Endpoint override?"]);
	});

	it("should write migrated state through the plugin's backend using the answers as its state block", async () => {
		expect.assertions(1);

		const buildStatePort = vi.fn<BuildStatePortFunc>(() => happyPortResult());
		const dependencies = makeDependencies({ buildStatePort, plugins: s3Plugins() });
		scriptPluginBackendPrompts(dependencies);

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(buildStatePort.mock.calls.map(([deps]) => deps.stateConfig)).toStrictEqual([
			{ backend: "s3", bucket: "my-bucket", region: "eu-west-2" },
		]);
	});

	it("should record the plugin that owns the chosen backend in the emitted config", async () => {
		expect.assertions(1);

		const writeFile = vi.fn<WriteFileFunc>();
		writeFile.mockResolvedValue();
		const dependencies = makeDependencies({ plugins: s3Plugins(), writeFile });
		scriptPluginBackendPrompts(dependencies);

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(writeFile).toHaveBeenCalledWith(
			CONFIG_TS_PATH,
			expect.stringContaining("@example/state-s3"),
		);
	});

	it("should write a yaml config when the user picks yaml format", async () => {
		expect.assertions(1);

		const writeFile = vi.fn<WriteFileFunc>(async () => {});
		const dependencies = makeDependencies({ writeFile });
		vi.mocked(dependencies.migratePromptPort!.promptStateFilePath).mockResolvedValueOnce({
			data: STATE_FILE_PATH,
			success: true,
		});
		vi.mocked(dependencies.migratePromptPort!.promptConfigFormat).mockResolvedValueOnce({
			data: "yaml",
			success: true,
		});
		vi.mocked(dependencies.migratePromptPort!.promptStateBackend).mockResolvedValueOnce({
			data: "gist",
			success: true,
		});
		vi.mocked(dependencies.migratePromptPort!.promptGistId).mockResolvedValueOnce({
			data: "abc",
			success: true,
		});

		await migrateCommand(dependencies)(undefined, { from: "mantle" });

		const configWrites = vi
			.mocked(writeFile)
			.mock.calls.filter(([path]) => path === CONFIG_YAML_PATH);

		expect(configWrites).toStrictEqual([[CONFIG_YAML_PATH, expect.any(String)]]);
	});

	function scriptLocalBackendPrompts(
		dependencies: ProgDependencies,
		stateFilePath: string,
	): void {
		vi.mocked(dependencies.migratePromptPort!.promptStateFilePath).mockResolvedValueOnce({
			data: stateFilePath,
			success: true,
		});
		vi.mocked(dependencies.migratePromptPort!.promptConfigFormat).mockResolvedValueOnce({
			data: "typescript",
			success: true,
		});
		vi.mocked(dependencies.migratePromptPort!.promptStateBackend).mockResolvedValueOnce({
			data: "local",
			success: true,
		});
	}

	it("should dump per-env state JSON beside bedrock.config when 'local' backend is picked", async () => {
		expect.assertions(3);

		const writeFile = vi.fn<WriteFileFunc>();
		writeFile.mockResolvedValue();
		const dependencies = makeDependencies({ writeFile });
		scriptLocalBackendPrompts(dependencies, STATE_FILE_PATH);

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(writeFile).toHaveBeenCalledWith(
			LOCAL_STATE_JSON_PATH,
			expect.stringContaining('"environment": "production"'),
		);
		expect(writeFile).toHaveBeenCalledWith(
			CONFIG_TS_PATH,
			expect.not.stringContaining('"state"'),
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should skip the gist-id prompt and buildStatePort when 'local' backend is picked", async () => {
		expect.assertions(3);

		const buildStatePort = vi.fn<BuildStatePortFunc>(() => happyPortResult());
		const dependencies = makeDependencies({ buildStatePort });
		scriptLocalBackendPrompts(dependencies, STATE_FILE_PATH);

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(dependencies.migratePromptPort!.promptGistId).not.toHaveBeenCalled();
		expect(buildStatePort).not.toHaveBeenCalled();
		expect(dependencies.clack!.logSuccess).toHaveBeenCalledWith(
			"production: 0 resources migrated",
		);
	});

	it("should create the local-dump output directory before writing per-env state files", async () => {
		expect.assertions(2);

		const mkdir = vi.fn<MkdirFunc>();
		mkdir.mockResolvedValue();
		const dependencies = makeDependencies({ mkdir });
		scriptLocalBackendPrompts(dependencies, STATE_FILE_PATH);

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(mkdir).toHaveBeenCalledWith(LOCAL_STATE_DIRECTORY);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should render an error and exit 1 when the local-dump mkdir rejects", async () => {
		expect.assertions(3);

		const mkdir = vi.fn<MkdirFunc>();
		mkdir.mockRejectedValueOnce(new Error("EACCES: permission denied"));
		const dependencies = makeDependencies({ mkdir });
		scriptLocalBackendPrompts(dependencies, STATE_FILE_PATH);

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			`local state directory create failed (${LOCAL_STATE_DIRECTORY}): EACCES: permission denied`,
		);
		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("migrate failed");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should default to recursive node mkdir when no mkdir slot is provided", async () => {
		expect.assertions(2);

		const temporaryDirectory = mkdtempSync(join(tmpdir(), "bedrock-migrate-local-"));
		onTestFinished(() => {
			rmSync(temporaryDirectory, { force: true, recursive: true });
		});
		const stateFilePath = join(temporaryDirectory, "missing-parent", ".mantle-state.yml");
		const exit = vi.fn<ExitFunc>();
		const migrate = vi.fn<MigrateFunc>();
		migrate.mockResolvedValue({ data: SAMPLE_REPORT, success: true });
		const promptPort = fakeMigratePromptPort();
		vi.mocked(promptPort.promptStateFilePath).mockResolvedValueOnce({
			data: stateFilePath,
			success: true,
		});
		vi.mocked(promptPort.promptConfigFormat).mockResolvedValueOnce({
			data: "typescript",
			success: true,
		});
		vi.mocked(promptPort.promptStateBackend).mockResolvedValueOnce({
			data: "local",
			success: true,
		});

		await migrateCommand({
			clack: fakeClackPort(),
			exit,
			migrateMantleState: migrate,
			migratePromptPort: promptPort,
			projectRoot: temporaryDirectory,
		})(stateFilePath, { from: "mantle" });

		expect(
			existsSync(join(temporaryDirectory, "missing-parent", ".bedrock", "state")),
		).toBeTrue();
		expect(exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should render an error and exit 1 when the local-dump writeFile rejects", async () => {
		expect.assertions(3);

		const writeFile = vi.fn<WriteFileFunc>();
		writeFile.mockRejectedValueOnce(new Error("EROFS: read-only file system"));
		const dependencies = makeDependencies({ writeFile });
		scriptLocalBackendPrompts(dependencies, STATE_FILE_PATH);

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			`local state write failed (${LOCAL_STATE_JSON_PATH}): EROFS: read-only file system`,
		);
		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("migrate failed");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should drop a pre-existing state field from the bedrock config when 'local' is picked", async () => {
		expect.assertions(1);

		const reportWithState: MigrationReport = {
			...SAMPLE_REPORT,
			config: {
				...SAMPLE_CONFIG,
				state: { backend: "gist", gistId: "leftover-from-source" },
			},
		};
		const migrate = vi.fn<MigrateFunc>();
		migrate.mockResolvedValue({ data: reportWithState, success: true });
		const writeFile = vi.fn<WriteFileFunc>();
		writeFile.mockResolvedValue();
		const dependencies = makeDependencies({ migrateMantleState: migrate, writeFile });
		scriptLocalBackendPrompts(dependencies, STATE_FILE_PATH);

		await migrateCommand(dependencies)(STATE_FILE_PATH, { from: "mantle" });

		expect(writeFile).toHaveBeenCalledWith(
			CONFIG_TS_PATH,
			expect.not.stringContaining("leftover-from-source"),
		);
	});

	it("should default to process.exit when no exit slot is provided", async () => {
		expect.assertions(1);

		onTestFinished(() => {
			exitSpy.mockRestore();
		});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(fromAny(() => {}));

		const dependencies = { clack: fakeClackPort(), loadProject: fakeLoadProject() };

		await migrateCommand(dependencies)(undefined, { from: "universe" });

		expect(exitSpy).toHaveBeenCalledExactlyOnceWith(1);
	});
});
