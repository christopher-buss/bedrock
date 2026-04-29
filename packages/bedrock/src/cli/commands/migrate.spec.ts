import { fakeClackPort } from "#tests/helpers/clack";
import { fakeMigratePromptPort } from "#tests/helpers/migrate-prompt-port";
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
type MigrateFunc = NonNullable<ProgDeps["migrateMantleState"]>;
type BuildStatePortFunc = NonNullable<ProgDeps["buildStatePort"]>;

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
	return {
		buildStatePort: vi.fn<BuildStatePortFunc>(() => ({ data: happyPort(), success: true })),
		clack: fakeClackPort(),
		exit: vi.fn<ExitFunc>(),
		migrateMantleState: migrate,
		migratePromptPort: fakeMigratePromptPort(),
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
	it("should surface a parse error and exit 1 when --from is missing", async () => {
		expect.assertions(3);

		const deps = makeDeps();

		await migrateCommand(deps)(undefined, {});

		expect(deps.clack?.logError).toHaveBeenCalledOnce();
		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("migrate failed");
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

		await migrateCommand(deps)("/projects/example/.mantle-state.yml", { from: "mantle" });

		expect(deps.clack?.intro).toHaveBeenCalledExactlyOnceWith("bedrock migrate");
		expect(deps.migrateMantleState).toHaveBeenCalledExactlyOnceWith({
			configFormat: "typescript",
			stateFilePath: "/projects/example/.mantle-state.yml",
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

		await migrateCommand(deps)("/projects/example/.mantle-state.yml", { from: "mantle" });

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

		await migrateCommand(deps)("/projects/example/.mantle-state.yml", { from: "mantle" });

		expect(writeFile).toHaveBeenCalledExactlyOnceWith(
			"/projects/example/bedrock.config.ts",
			expect.any(String),
		);
		expect(deps.clack?.logSuccess).toHaveBeenCalledWith(
			"wrote /projects/example/bedrock.config.ts",
		);
		expect(deps.clack?.outro).toHaveBeenCalledExactlyOnceWith("migrate succeeded");
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

		await migrateCommand(deps)("/projects/example/.mantle-state.yml", { from: "mantle" });

		expect(deps.clack?.logError).toHaveBeenCalledExactlyOnceWith(
			"failed to read Mantle state file '/projects/example/.mantle-state.yml': EACCES: permission denied",
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

		await migrateCommand(deps)("/projects/example/.mantle-state.yml", { from: "mantle" });

		expect(deps.clack?.logError).toHaveBeenCalledExactlyOnceWith(
			"failed to read Mantle state file '/projects/example/.mantle-state.yml': raw-string-failure",
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

		await migrateCommand(deps)("/projects/example/.mantle-state.yml", { from: "mantle" });

		expect(deps.clack?.logError).toHaveBeenCalledExactlyOnceWith(
			"failed to read Mantle state file '/projects/example/.mantle-state.yml': ENOSPC: no space left on device",
		);
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should render a config-write error and exit 1 when writeFile rejects", async () => {
		expect.assertions(3);

		const writeFile = vi.fn<WriteFileFunc>();
		writeFile.mockRejectedValueOnce(new Error("EROFS: read-only file system"));
		const deps = makeDeps({ writeFile });
		scriptHappyPrompts(deps);

		await migrateCommand(deps)("/projects/example/.mantle-state.yml", { from: "mantle" });

		expect(deps.clack?.logError).toHaveBeenCalledExactlyOnceWith(
			"config file write failed (/projects/example/bedrock.config.ts): EROFS: read-only file system",
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

	it("should skip every warning category whose summary count is zero", async () => {
		expect.assertions(1);

		const deps = makeDeps();
		scriptHappyPrompts(deps);

		await migrateCommand(deps)("./.mantle-state.yml", { from: "mantle" });

		expect(deps.clack?.logMessage).not.toHaveBeenCalled();
	});

	it("should render every warning category present in the report summary", async () => {
		expect.assertions(4);

		const reportWithWarnings: MigrationReport = {
			...SAMPLE_REPORT,
			summary: {
				ambiguousCount: 4,
				blockedCount: 3,
				deferredCount: 2,
				interpretiveCount: 1,
			},
		};
		const migrateMantleState = vi.fn<MigrateFunc>(async () => {
			return { data: reportWithWarnings, success: true };
		});
		const deps = makeDeps({ migrateMantleState });
		scriptHappyPrompts(deps);

		await migrateCommand(deps)("./.mantle-state.yml", { from: "mantle" });

		expect(deps.clack?.logMessage).toHaveBeenCalledWith("interpretive mappings: 1");
		expect(deps.clack?.logMessage).toHaveBeenCalledWith("deferred fields: 2");
		expect(deps.clack?.logMessage).toHaveBeenCalledWith("blocked fields: 3");
		expect(deps.clack?.logMessage).toHaveBeenCalledWith("ambiguous fields: 4");
	});

	it("should write a yaml config when the user picks yaml format", async () => {
		expect.assertions(1);

		const writeFile = vi.fn<WriteFileFunc>(async () => {});
		const deps = makeDeps({ writeFile });
		vi.mocked(deps.migratePromptPort!.promptStateFilePath).mockResolvedValueOnce({
			data: "/projects/example/.mantle-state.yml",
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

		expect(writeFile).toHaveBeenCalledExactlyOnceWith(
			"/projects/example/bedrock.config.yaml",
			expect.any(String),
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

		await migrateCommand({ clack: fakeClackPort() })(undefined, {});

		expect(exitSpy).toHaveBeenCalledExactlyOnceWith(1);
	});
});
