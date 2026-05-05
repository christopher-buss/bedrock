import { fakeClackPort } from "#tests/helpers/clack";
import { fakeMigratePromptPort } from "#tests/helpers/migrate-prompt-port";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import type { MigrationReport } from "../../core/migrate/migration-report.ts";
import type { Config } from "../../core/schema.ts";
import type { BedrockState, StateError } from "../../core/state.ts";
import type { StatePort } from "../../ports/state-port.ts";
import type { ProgDeps } from "../index.ts";
import { migrateCommand } from "./migrate.ts";

type ExitFunc = NonNullable<ProgDeps["exit"]>;
type WriteFileFunc = NonNullable<ProgDeps["writeFile"]>;
type MkdirFunc = NonNullable<ProgDeps["mkdir"]>;
type MigrateFunc = NonNullable<ProgDeps["migrateMantleState"]>;
type BuildStatePortFunc = NonNullable<ProgDeps["buildStatePort"]>;

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
		read: vi.fn<StatePort["read"]>(async () => ({ data: undefined, success: true })),
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

function makeDeps(overrides: Partial<ProgDeps> = {}): ProgDeps {
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
		migrateMantleState: migrate,
		migratePromptPort: fakeMigratePromptPort(),
		mkdir,
		writeFile,
		...overrides,
	};
}

function scriptHappyPrompts(deps: ProgDeps): void {
	const port = deps.migratePromptPort;
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

		const deps = makeDeps();
		scriptHappyPrompts(deps);
		vi.mocked(deps.migratePromptPort!.promptMigrationSource).mockResolvedValueOnce({
			data: "mantle",
			success: true,
		});

		await migrateCommand(deps)("./.mantle-state.yml", {});

		expect(deps.migratePromptPort?.promptMigrationSource).toHaveBeenCalledOnce();
		expect(deps.migrateMantleState).toHaveBeenCalledOnce();
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should cancel cleanly when the user aborts the migration-source prompt", async () => {
		expect.assertions(2);

		const deps = makeDeps();
		vi.mocked(deps.migratePromptPort!.promptMigrationSource).mockResolvedValueOnce({
			err: { kind: "cancelled" },
			success: false,
		});

		await migrateCommand(deps)("./.mantle-state.yml", {});

		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("migrate cancelled");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should reject an unknown --from source with the unknownSource diagnostic", async () => {
		expect.assertions(2);

		const deps = makeDeps();

		await migrateCommand(deps)(undefined, { from: "universe" });

		expect(deps.clack?.logError).toHaveBeenCalledExactlyOnceWith(
			"unknown migration source 'universe' (supported: mantle)",
		);
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should call the migrator once with the picked format and resolved path", async () => {
		expect.assertions(3);

		const deps = makeDeps();
		scriptHappyPrompts(deps);

		await migrateCommand(deps)(STATE_FILE_PATH, { from: "mantle" });

		expect(deps.clack?.intro).toHaveBeenCalledExactlyOnceWith("bedrock migrate");
		expect(deps.migrateMantleState).toHaveBeenCalledExactlyOnceWith({
			configFormat: "typescript",
			stateFilePath: STATE_FILE_PATH,
		});

		const firstCallDeps = vi.mocked(deps.migrateMantleState!).mock.calls[0]?.[0];

		expect(Object.hasOwn(firstCallDeps ?? {}, "primaryEnvironment")).toBeFalse();
	});

	it("should write each environment's state through the StatePort and log per-env success", async () => {
		expect.assertions(3);

		const writeSpy = makeWriteSpy();
		const buildStatePort = vi.fn<BuildStatePortFunc>(() => happyPortResult(writeSpy));
		const deps = makeDeps({ buildStatePort });
		scriptHappyPrompts(deps);

		await migrateCommand(deps)(STATE_FILE_PATH, { from: "mantle" });

		expect(writeSpy).toHaveBeenCalledExactlyOnceWith(SAMPLE_STATE);
		expect(deps.clack?.logSuccess).toHaveBeenCalledWith("production: 0 resources migrated");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should write the bedrock config beside the state file and log the path", async () => {
		expect.assertions(3);

		const writeFile = vi.fn<WriteFileFunc>();
		writeFile.mockResolvedValue();
		const deps = makeDeps({ writeFile });
		scriptHappyPrompts(deps);

		await migrateCommand(deps)(STATE_FILE_PATH, { from: "mantle" });

		const configWrites = vi
			.mocked(writeFile)
			.mock.calls.filter(([path]) => path === CONFIG_TS_PATH);

		expect(configWrites).toStrictEqual([[CONFIG_TS_PATH, expect.any(String)]]);
		expect(deps.clack?.logSuccess).toHaveBeenCalledWith(`wrote ${CONFIG_TS_PATH}`);
		expect(deps.clack?.outro).toHaveBeenCalledExactlyOnceWith("migrate succeeded");
	});

	it("should write the migration report json and markdown alongside the state files", async () => {
		expect.assertions(3);

		const writeFile = vi.fn<WriteFileFunc>();
		writeFile.mockResolvedValue();
		const mkdir = vi.fn<MkdirFunc>();
		mkdir.mockResolvedValue();
		const deps = makeDeps({ mkdir, writeFile });
		scriptHappyPrompts(deps);

		await migrateCommand(deps)(STATE_FILE_PATH, { from: "mantle" });

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
		const deps = makeDeps({ mkdir });
		scriptHappyPrompts(deps);

		await migrateCommand(deps)(STATE_FILE_PATH, { from: "mantle" });

		expect(deps.clack?.logError).toHaveBeenCalledExactlyOnceWith(
			`migration report directory create failed (${REPORT_DIRECTORY}): EACCES: permission denied`,
		);
		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("migrate failed");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should render an error and exit 1 when the migration report json write rejects", async () => {
		expect.assertions(3);

		// First write is the bedrock config; second is migration-report.json.
		const writeFile = vi
			.fn<WriteFileFunc>()
			.mockResolvedValueOnce()
			.mockRejectedValueOnce(new Error("EROFS: read-only file system"));
		const deps = makeDeps({ writeFile });
		scriptHappyPrompts(deps);

		await migrateCommand(deps)(STATE_FILE_PATH, { from: "mantle" });

		expect(deps.clack?.logError).toHaveBeenCalledExactlyOnceWith(
			`migration report write failed (${REPORT_JSON_PATH}): EROFS: read-only file system`,
		);
		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("migrate failed");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should render an error and exit 1 when the migration report markdown write rejects", async () => {
		expect.assertions(3);

		// 1: bedrock config (ok). 2: migration-report.json (ok). 3: .md (reject).
		const writeFile = vi
			.fn<WriteFileFunc>()
			.mockResolvedValueOnce()
			.mockResolvedValueOnce()
			.mockRejectedValueOnce(new Error("ENOSPC: no space left on device"));
		const deps = makeDeps({ writeFile });
		scriptHappyPrompts(deps);

		await migrateCommand(deps)(STATE_FILE_PATH, { from: "mantle" });

		expect(deps.clack?.logError).toHaveBeenCalledExactlyOnceWith(
			`migration report write failed (${REPORT_MD_PATH}): ENOSPC: no space left on device`,
		);
		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("migrate failed");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should pass process.env through getEnv when constructing the StatePort", async () => {
		expect.assertions(1);

		onTestFinished(() => {
			vi.unstubAllEnvs();
		});
		vi.stubEnv("GITHUB_TOKEN", "from-process");

		const buildStatePort = vi.fn<BuildStatePortFunc>(() => happyPortResult());
		const deps = makeDeps({ buildStatePort });
		scriptHappyPrompts(deps);

		await migrateCommand(deps)("./.mantle-state.yml", { from: "mantle" });

		const firstCall = vi.mocked(buildStatePort).mock.calls[0]?.[0];

		expect(firstCall?.getEnv("GITHUB_TOKEN")).toBe("from-process");
	});

	it("should render an io error and exit 1 when the migrator throws (e.g. EACCES)", async () => {
		expect.assertions(3);

		const migrateMantleState = vi.fn<MigrateFunc>(async () => {
			throw new Error("EACCES: permission denied");
		});
		const deps = makeDeps({ migrateMantleState });
		scriptHappyPrompts(deps);

		await migrateCommand(deps)(STATE_FILE_PATH, { from: "mantle" });

		expect(deps.clack?.logError).toHaveBeenCalledExactlyOnceWith(
			`failed to read Mantle state file '${STATE_FILE_PATH}': EACCES: permission denied`,
		);
		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("migrate failed");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should describe a non-Error throw value via String(value)", async () => {
		expect.assertions(1);

		const migrateMantleState = vi.fn<MigrateFunc>();
		migrateMantleState.mockRejectedValueOnce("raw-string-failure");
		const deps = makeDeps({ migrateMantleState });
		scriptHappyPrompts(deps);

		await migrateCommand(deps)(STATE_FILE_PATH, { from: "mantle" });

		expect(deps.clack?.logError).toHaveBeenCalledExactlyOnceWith(
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
		const deps = makeDeps({ migrateMantleState });
		scriptHappyPrompts(deps);
		vi.mocked(deps.migratePromptPort!.promptPrimaryEnvironment).mockResolvedValueOnce({
			data: "production",
			success: true,
		});

		await migrateCommand(deps)(STATE_FILE_PATH, { from: "mantle" });

		expect(deps.clack?.logError).toHaveBeenCalledExactlyOnceWith(
			`failed to read Mantle state file '${STATE_FILE_PATH}': ENOSPC: no space left on device`,
		);
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should render a config-write error and exit 1 when writeFile rejects", async () => {
		expect.assertions(3);

		const writeFile = vi.fn<WriteFileFunc>();
		writeFile.mockRejectedValueOnce(new Error("EROFS: read-only file system"));
		const deps = makeDeps({ writeFile });
		scriptHappyPrompts(deps);

		await migrateCommand(deps)(STATE_FILE_PATH, { from: "mantle" });

		expect(deps.clack?.logError).toHaveBeenCalledExactlyOnceWith(
			`config file write failed (${CONFIG_TS_PATH}): EROFS: read-only file system`,
		);
		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("migrate failed");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should fall back to clack.text when the positional path is omitted", async () => {
		expect.assertions(2);

		const deps = makeDeps();
		scriptHappyPrompts(deps);

		await migrateCommand(deps)(undefined, { from: "mantle" });

		expect(deps.migratePromptPort?.promptStateFilePath).toHaveBeenCalledOnce();
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(0);
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
		const deps = makeDeps({ migrateMantleState });
		scriptHappyPrompts(deps);
		vi.mocked(deps.migratePromptPort!.promptPrimaryEnvironment).mockResolvedValueOnce({
			data: "production",
			success: true,
		});

		await migrateCommand(deps)("./.mantle-state.yml", { from: "mantle" });

		expect(migrateMantleState).toHaveBeenCalledTimes(2);
		expect(migrateMantleState).toHaveBeenLastCalledWith(
			expect.objectContaining({ primaryEnvironment: "production" }),
		);
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should render the migrator error and exit 1 on a non-recoverable failure", async () => {
		expect.assertions(3);

		const migrateMantleState = vi.fn<MigrateFunc>(async () => {
			return {
				err: { kind: "stateFileNotFound", path: "./.mantle-state.yml" },
				success: false,
			};
		});
		const deps = makeDeps({ migrateMantleState });
		scriptHappyPrompts(deps);

		await migrateCommand(deps)("./.mantle-state.yml", { from: "mantle" });

		expect(deps.clack?.logError).toHaveBeenCalledExactlyOnceWith(
			"Mantle state file not found at './.mantle-state.yml'",
		);
		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("migrate failed");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
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
		const deps = makeDeps({ migrateMantleState });
		scriptHappyPrompts(deps);
		vi.mocked(deps.migratePromptPort!.promptPrimaryEnvironment).mockResolvedValueOnce({
			data: "ghost",
			success: true,
		});

		await migrateCommand(deps)("./.mantle-state.yml", { from: "mantle" });

		expect(deps.clack?.logError).toHaveBeenCalledExactlyOnceWith(
			"primary environment 'ghost' not found (available: production, staging)",
		);
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should render the buildStatePort error when constructing the StatePort fails", async () => {
		expect.assertions(2);

		const buildStatePort = vi.fn<BuildStatePortFunc>(() => {
			return {
				err: {
					kind: "missingCredential",
					purpose: "stateBackend",
					variable: "GITHUB_TOKEN",
				},
				success: false,
			};
		});
		const deps = makeDeps({ buildStatePort });
		scriptHappyPrompts(deps);

		await migrateCommand(deps)("./.mantle-state.yml", { from: "mantle" });

		expect(deps.clack?.logError).toHaveBeenCalledExactlyOnceWith(
			"missing credential: environment variable GITHUB_TOKEN is not set",
		);
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should render the unsupportedBackend error from buildStatePort", async () => {
		expect.assertions(1);

		const buildStatePort = vi.fn<BuildStatePortFunc>(() => {
			return {
				err: { backend: "s3", hint: "pass a custom statePort", kind: "unsupportedBackend" },
				success: false,
			};
		});
		const deps = makeDeps({ buildStatePort });
		scriptHappyPrompts(deps);

		await migrateCommand(deps)("./.mantle-state.yml", { from: "mantle" });

		expect(deps.clack?.logError).toHaveBeenCalledExactlyOnceWith(
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
		const deps = makeDeps({ buildStatePort });
		scriptHappyPrompts(deps);

		await migrateCommand(deps)("./.mantle-state.yml", { from: "mantle" });

		expect(deps.clack?.logError).toHaveBeenCalledExactlyOnceWith(
			"state write failed for 'production' (state.json): auth 401",
		);
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should cancel cleanly when the user aborts the config-format prompt", async () => {
		expect.assertions(2);

		const deps = makeDeps();
		scriptHappyPrompts(deps);
		vi.mocked(deps.migratePromptPort!.promptConfigFormat).mockReset();
		vi.mocked(deps.migratePromptPort!.promptConfigFormat).mockResolvedValueOnce({
			err: { kind: "cancelled" },
			success: false,
		});

		await migrateCommand(deps)("./.mantle-state.yml", { from: "mantle" });

		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("migrate cancelled");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should cancel cleanly when the user aborts the state-backend prompt", async () => {
		expect.assertions(2);

		const deps = makeDeps();
		scriptHappyPrompts(deps);
		vi.mocked(deps.migratePromptPort!.promptStateBackend).mockReset();
		vi.mocked(deps.migratePromptPort!.promptStateBackend).mockResolvedValueOnce({
			err: { kind: "cancelled" },
			success: false,
		});

		await migrateCommand(deps)("./.mantle-state.yml", { from: "mantle" });

		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("migrate cancelled");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should cancel cleanly when the user aborts the gist-id prompt", async () => {
		expect.assertions(2);

		const deps = makeDeps();
		scriptHappyPrompts(deps);
		vi.mocked(deps.migratePromptPort!.promptGistId).mockReset();
		vi.mocked(deps.migratePromptPort!.promptGistId).mockResolvedValueOnce({
			err: { kind: "cancelled" },
			success: false,
		});

		await migrateCommand(deps)("./.mantle-state.yml", { from: "mantle" });

		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("migrate cancelled");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should cancel cleanly when the user aborts the path prompt", async () => {
		expect.assertions(2);

		const deps = makeDeps();
		vi.mocked(deps.migratePromptPort!.promptStateFilePath).mockResolvedValueOnce({
			err: { kind: "cancelled" },
			success: false,
		});

		await migrateCommand(deps)(undefined, { from: "mantle" });

		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("migrate cancelled");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should cancel cleanly when the user aborts the primary-env prompt", async () => {
		expect.assertions(1);

		const migrateMantleState = vi.fn<MigrateFunc>(async () => {
			return {
				err: { available: ["production", "staging"], kind: "primaryEnvironmentRequired" },
				success: false,
			};
		});
		const deps = makeDeps({ migrateMantleState });
		scriptHappyPrompts(deps);
		vi.mocked(deps.migratePromptPort!.promptPrimaryEnvironment).mockResolvedValueOnce({
			err: { kind: "cancelled" },
			success: false,
		});

		await migrateCommand(deps)("./.mantle-state.yml", { from: "mantle" });

		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("migrate cancelled");
	});

	it("should stay silent in the summary when every warning count is zero", async () => {
		expect.assertions(2);

		const deps = makeDeps();
		scriptHappyPrompts(deps);

		await migrateCommand(deps)("./.mantle-state.yml", { from: "mantle" });

		expect(deps.clack?.logError).not.toHaveBeenCalled();
		// logSuccess fires for state and config writes; assert only that the
		// review-prompt success line does not.
		expect(deps.clack?.logSuccess).not.toHaveBeenCalledWith(
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
		const deps = makeDeps({ migrateMantleState });
		scriptHappyPrompts(deps);

		await migrateCommand(deps)("./.mantle-state.yml", { from: "mantle" });

		expect(deps.clack?.logError).toHaveBeenCalledWith(
			expect.stringMatching(
				/^action required: 4 fields need your input\. See .*\.bedrock[\\/]migration-report\.md$/,
			),
		);
		// Auto-mapped success line should not fire when ambiguous > 0.
		expect(deps.clack?.logSuccess).not.toHaveBeenCalledWith(
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
		const deps = makeDeps({ migrateMantleState });
		scriptHappyPrompts(deps);

		await migrateCommand(deps)("./.mantle-state.yml", { from: "mantle" });

		expect(deps.clack?.logSuccess).toHaveBeenCalledWith(
			expect.stringMatching(
				/^migration complete; see .*\.bedrock[\\/]migration-report\.md for 6 auto-mapped or skipped fields$/,
			),
		);
		expect(deps.clack?.logError).not.toHaveBeenCalled();
	});

	it("should write a yaml config when the user picks yaml format", async () => {
		expect.assertions(1);

		const writeFile = vi.fn<WriteFileFunc>(async () => {});
		const deps = makeDeps({ writeFile });
		vi.mocked(deps.migratePromptPort!.promptStateFilePath).mockResolvedValueOnce({
			data: STATE_FILE_PATH,
			success: true,
		});
		vi.mocked(deps.migratePromptPort!.promptConfigFormat).mockResolvedValueOnce({
			data: "yaml",
			success: true,
		});
		vi.mocked(deps.migratePromptPort!.promptStateBackend).mockResolvedValueOnce({
			data: "gist",
			success: true,
		});
		vi.mocked(deps.migratePromptPort!.promptGistId).mockResolvedValueOnce({
			data: "abc",
			success: true,
		});

		await migrateCommand(deps)(undefined, { from: "mantle" });

		const configWrites = vi
			.mocked(writeFile)
			.mock.calls.filter(([path]) => path === CONFIG_YAML_PATH);

		expect(configWrites).toStrictEqual([[CONFIG_YAML_PATH, expect.any(String)]]);
	});

	function scriptLocalBackendPrompts(deps: ProgDeps, stateFilePath: string): void {
		vi.mocked(deps.migratePromptPort!.promptStateFilePath).mockResolvedValueOnce({
			data: stateFilePath,
			success: true,
		});
		vi.mocked(deps.migratePromptPort!.promptConfigFormat).mockResolvedValueOnce({
			data: "typescript",
			success: true,
		});
		vi.mocked(deps.migratePromptPort!.promptStateBackend).mockResolvedValueOnce({
			data: "local",
			success: true,
		});
	}

	it("should dump per-env state JSON beside bedrock.config when 'local' backend is picked", async () => {
		expect.assertions(3);

		const writeFile = vi.fn<WriteFileFunc>();
		writeFile.mockResolvedValue();
		const deps = makeDeps({ writeFile });
		scriptLocalBackendPrompts(deps, STATE_FILE_PATH);

		await migrateCommand(deps)(STATE_FILE_PATH, { from: "mantle" });

		expect(writeFile).toHaveBeenCalledWith(
			LOCAL_STATE_JSON_PATH,
			expect.stringContaining('"environment": "production"'),
		);
		expect(writeFile).toHaveBeenCalledWith(
			CONFIG_TS_PATH,
			expect.not.stringContaining('"state"'),
		);
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should skip the gist-id prompt and buildStatePort when 'local' backend is picked", async () => {
		expect.assertions(3);

		const buildStatePort = vi.fn<BuildStatePortFunc>(() => happyPortResult());
		const deps = makeDeps({ buildStatePort });
		scriptLocalBackendPrompts(deps, STATE_FILE_PATH);

		await migrateCommand(deps)(STATE_FILE_PATH, { from: "mantle" });

		expect(deps.migratePromptPort?.promptGistId).not.toHaveBeenCalled();
		expect(buildStatePort).not.toHaveBeenCalled();
		expect(deps.clack?.logSuccess).toHaveBeenCalledWith("production: 0 resources migrated");
	});

	it("should create the local-dump output directory before writing per-env state files", async () => {
		expect.assertions(2);

		const mkdir = vi.fn<MkdirFunc>();
		mkdir.mockResolvedValue();
		const deps = makeDeps({ mkdir });
		scriptLocalBackendPrompts(deps, STATE_FILE_PATH);

		await migrateCommand(deps)(STATE_FILE_PATH, { from: "mantle" });

		expect(mkdir).toHaveBeenCalledWith(LOCAL_STATE_DIRECTORY);
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should render an error and exit 1 when the local-dump mkdir rejects", async () => {
		expect.assertions(3);

		const mkdir = vi.fn<MkdirFunc>();
		mkdir.mockRejectedValueOnce(new Error("EACCES: permission denied"));
		const deps = makeDeps({ mkdir });
		scriptLocalBackendPrompts(deps, STATE_FILE_PATH);

		await migrateCommand(deps)(STATE_FILE_PATH, { from: "mantle" });

		expect(deps.clack?.logError).toHaveBeenCalledExactlyOnceWith(
			`local state directory create failed (${LOCAL_STATE_DIRECTORY}): EACCES: permission denied`,
		);
		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("migrate failed");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
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
		const deps = makeDeps({ writeFile });
		scriptLocalBackendPrompts(deps, STATE_FILE_PATH);

		await migrateCommand(deps)(STATE_FILE_PATH, { from: "mantle" });

		expect(deps.clack?.logError).toHaveBeenCalledExactlyOnceWith(
			`local state write failed (${LOCAL_STATE_JSON_PATH}): EROFS: read-only file system`,
		);
		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("migrate failed");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
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
		const deps = makeDeps({ migrateMantleState: migrate, writeFile });
		scriptLocalBackendPrompts(deps, STATE_FILE_PATH);

		await migrateCommand(deps)(STATE_FILE_PATH, { from: "mantle" });

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
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation((() => {}) as typeof process.exit);

		await migrateCommand({ clack: fakeClackPort() })(undefined, { from: "universe" });

		expect(exitSpy).toHaveBeenCalledExactlyOnceWith(1);
	});
});
