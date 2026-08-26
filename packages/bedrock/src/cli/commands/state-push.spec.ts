import type { Result } from "@bedrock-rbx/ocale";
import { fromAny } from "@total-typescript/shoehorn";

import { join } from "node:path";
import process from "node:process";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { fakeClackPort } from "#tests/helpers/clack";
import { gamePassCurrent } from "#tests/helpers/resources";
import type { ConfigError } from "../../core/config-error.ts";
import { EMPTY_PLUGIN_REGISTRY } from "../../core/plugin-registry.ts";
import type { ResourceCurrentState } from "../../core/resources.ts";
import type { Config } from "../../core/schema.ts";
import { serializeStateFile } from "../../core/state-file.ts";
import type { BedrockState } from "../../core/state.ts";
import type { StatePort } from "../../ports/state-port.ts";
import { asResourceKey } from "../../types/ids.ts";
import type { ProgDeps as ProgDependencies } from "../index.ts";
import { statePushCommand } from "./state-push.ts";

type BuildStatePortFunc = NonNullable<ProgDependencies["buildStatePort"]>;
type ExitFunc = NonNullable<ProgDependencies["exit"]>;
type LoadProjectFunc = NonNullable<ProgDependencies["loadProject"]>;
type ReadTextFileFunc = NonNullable<ProgDependencies["readTextFile"]>;
type RemoveFileFunc = NonNullable<ProgDependencies["removeFile"]>;

const PROJECT_ROOT = "/project";
const DUMP_PATH = join(PROJECT_ROOT, ".bedrock", "recovery", "production.json");

const SAMPLE_CONFIG: Config = {
	environments: { production: {} },
	state: { backend: "gist", gistId: "abc123" },
};

function passResource(): ResourceCurrentState {
	return gamePassCurrent();
}

function dumpedState(environment = "production"): BedrockState {
	return { environment, resources: [passResource()], version: 1 };
}

function fakeLoad(result?: Result<Config, ConfigError>): LoadProjectFunc {
	const loaded = result ?? { data: SAMPLE_CONFIG, success: true };
	return vi.fn<LoadProjectFunc>(async () => {
		return loaded.success
			? { data: { config: loaded.data, plugins: EMPTY_PLUGIN_REGISTRY }, success: true }
			: loaded;
	});
}

function fakeReadDump(byPath: Readonly<Record<string, Error | string>>): ReadTextFileFunc {
	return vi.fn<ReadTextFileFunc>(async (path) => {
		const answer = byPath[path] ?? new Error(`ENOENT: no such file, open '${path}'`);
		if (answer instanceof Error) {
			throw answer;
		}

		return answer;
	});
}

function portReturning(write: StatePort["write"]): BuildStatePortFunc {
	return vi.fn<BuildStatePortFunc>(() => {
		return {
			data: {
				read: vi.fn<StatePort["read"]>(async () => ({ data: undefined, success: true })),
				write,
			},
			success: true,
		};
	});
}

function makeDependencies(overrides: Partial<ProgDependencies> = {}): ProgDependencies {
	return {
		buildStatePort: portReturning(
			vi.fn<StatePort["write"]>(async () => ({ data: undefined, success: true })),
		),
		clack: fakeClackPort(),
		exit: vi.fn<ExitFunc>(),
		loadProject: fakeLoad(),
		projectRoot: PROJECT_ROOT,
		readTextFile: fakeReadDump({ [DUMP_PATH]: serializeStateFile(dumpedState()) }),
		removeFile: vi.fn<RemoveFileFunc>(async () => {}),
		...overrides,
	};
}

describe(statePushCommand, () => {
	it("should write the dumped state through the configured backend and report what it wrote", async () => {
		expect.assertions(5);

		const write = vi.fn<StatePort["write"]>(async () => ({ data: undefined, success: true }));
		const dependencies = makeDependencies({ buildStatePort: portReturning(write) });

		await statePushCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.intro).toHaveBeenCalledExactlyOnceWith("bedrock state push");
		expect(write).toHaveBeenCalledExactlyOnceWith(dumpedState());
		expect(dependencies.clack!.logSuccess).toHaveBeenCalledExactlyOnceWith(
			`production: 1 resource pushed from ${DUMP_PATH}, which has been removed`,
		);
		expect(dependencies.clack!.outro).toHaveBeenCalledExactlyOnceWith("state push succeeded");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should remove the dump it pushed so a later push cannot revert the record", async () => {
		expect.assertions(2);

		const removeFile = vi.fn<RemoveFileFunc>(async () => {});
		const dependencies = makeDependencies({ removeFile });

		await statePushCommand(dependencies)({ env: "production" });

		expect(removeFile).toHaveBeenCalledExactlyOnceWith(DUMP_PATH);
		expect(dependencies.clack!.logSuccess).toHaveBeenCalledExactlyOnceWith(
			`production: 1 resource pushed from ${DUMP_PATH}, which has been removed`,
		);
	});

	it("should say the pushed dump is still on disk when it cannot be removed", async () => {
		expect.assertions(2);

		const dependencies = makeDependencies({
			removeFile: vi.fn<RemoveFileFunc>(async () => {
				throw new Error("EACCES");
			}),
		});

		await statePushCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logMessage).toHaveBeenCalledExactlyOnceWith(
			`${DUMP_PATH} could not be removed (EACCES). Delete it, so a later push cannot revert this state.`,
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should leave the dump in place when the push itself failed", async () => {
		expect.assertions(1);

		const removeFile = vi.fn<RemoveFileFunc>();
		const dependencies = makeDependencies({
			buildStatePort: portReturning(
				vi.fn<StatePort["write"]>(async () => {
					return {
						err: { file: "gist:abc123", kind: "stateAccessDenied", reason: "403" },
						success: false,
					};
				}),
			),
			removeFile,
		});

		await statePushCommand(dependencies)({ env: "production" });

		expect(removeFile).not.toHaveBeenCalled();
	});

	it("should build the state port from the environment's resolved state config", async () => {
		expect.assertions(1);

		const buildStatePort = portReturning(
			vi.fn<StatePort["write"]>(async () => ({ data: undefined, success: true })),
		);
		const dependencies = makeDependencies({ buildStatePort });

		await statePushCommand(dependencies)({ env: "production" });

		expect(buildStatePort).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				plugins: EMPTY_PLUGIN_REGISTRY,
				stateConfig: { backend: "gist", gistId: "abc123" },
			}),
		);
	});

	it("should read the credential override from --github-token", async () => {
		expect.assertions(1);

		const seen: Array<string | undefined> = [];
		const buildStatePort = vi.fn<BuildStatePortFunc>((deps) => {
			seen.push(deps.getEnv("BEDROCK_GITHUB_TOKEN"));
			return {
				data: {
					read: vi.fn<StatePort["read"]>(),
					write: vi.fn<StatePort["write"]>(async () => {
						return {
							data: undefined,
							success: true,
						};
					}),
				},
				success: true,
			};
		});

		await statePushCommand(makeDependencies({ buildStatePort }))({
			"env": "production",
			"github-token": "ghp_override",
		});

		expect(seen).toStrictEqual(["ghp_override"]);
	});

	it("should fall back to the process environment for a credential no flag overrode", async () => {
		expect.assertions(1);

		onTestFinished(() => {
			vi.unstubAllEnvs();
		});
		vi.stubEnv("BEDROCK_GITHUB_TOKEN", "ghp_from_environment");
		const seen: Array<string | undefined> = [];
		const buildStatePort = vi.fn<BuildStatePortFunc>((deps) => {
			seen.push(deps.getEnv("BEDROCK_GITHUB_TOKEN"));
			return {
				data: {
					read: vi.fn<StatePort["read"]>(),
					write: vi.fn<StatePort["write"]>(async () => {
						return { data: undefined, success: true };
					}),
				},
				success: true,
			};
		});

		await statePushCommand(makeDependencies({ buildStatePort }))({ env: "production" });

		expect(seen).toStrictEqual(["ghp_from_environment"]);
	});

	it("should push every requested environment in turn", async () => {
		expect.assertions(2);

		const stagingPath = join(PROJECT_ROOT, ".bedrock", "recovery", "staging.json");
		const write = vi.fn<StatePort["write"]>(async () => ({ data: undefined, success: true }));
		const dependencies = makeDependencies({
			buildStatePort: portReturning(write),
			loadProject: fakeLoad({
				data: {
					environments: { production: {}, staging: {} },
					state: { backend: "gist", gistId: "abc123" },
				},
				success: true,
			}),
			readTextFile: fakeReadDump({
				[DUMP_PATH]: serializeStateFile(dumpedState()),
				[stagingPath]: serializeStateFile(dumpedState("staging")),
			}),
		});

		await statePushCommand(dependencies)({ env: ["production", "staging"] });

		expect(write.mock.calls.map(([state]) => state.environment)).toStrictEqual([
			"production",
			"staging",
		]);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should report the parse failure and exit 1 when the dumped file is not valid state", async () => {
		expect.assertions(3);

		const write = vi.fn<StatePort["write"]>();
		const dependencies = makeDependencies({
			buildStatePort: portReturning(write),
			readTextFile: fakeReadDump({ [DUMP_PATH]: "{ not json" }),
		});

		await statePushCommand(dependencies)({ env: "production" });

		expect(write).not.toHaveBeenCalled();
		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			expect.stringContaining("malformed JSON"),
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should report the read failure verbatim when the recovery file cannot be read", async () => {
		expect.assertions(2);

		const dependencies = makeDependencies({ readTextFile: fakeReadDump({}) });

		await statePushCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			`cannot read the unsaved state at ${DUMP_PATH}: ENOENT: no such file, open '${DUMP_PATH}'`,
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should refuse a dump recorded for a different environment", async () => {
		expect.assertions(2);

		const write = vi.fn<StatePort["write"]>();
		const dependencies = makeDependencies({
			buildStatePort: portReturning(write),
			readTextFile: fakeReadDump({ [DUMP_PATH]: serializeStateFile(dumpedState("staging")) }),
		});

		await statePushCommand(dependencies)({ env: "production" });

		expect(write).not.toHaveBeenCalled();
		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			`${DUMP_PATH} holds state for 'staging', not 'production'`,
		);
	});

	it("should report the backend refusal when the state write fails", async () => {
		expect.assertions(2);

		const dependencies = makeDependencies({
			buildStatePort: portReturning(
				vi.fn<StatePort["write"]>(async () => {
					return {
						err: { file: "gist:abc123", kind: "stateAccessDenied", reason: "403" },
						success: false,
					};
				}),
			),
		});

		await statePushCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			expect.stringContaining("state write failed for 'production'"),
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should report the missing credential when the state port cannot be built", async () => {
		expect.assertions(2);

		const dependencies = makeDependencies({
			buildStatePort: vi.fn<BuildStatePortFunc>(() => {
				return {
					err: {
						kind: "missingCredential",
						purpose: "stateBackend",
						variable: "BEDROCK_GITHUB_TOKEN",
					},
					success: false,
				};
			}),
		});

		await statePushCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			expect.stringContaining("BEDROCK_GITHUB_TOKEN"),
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should report that state is not configured for the environment", async () => {
		expect.assertions(3);

		const buildStatePort = vi.fn<BuildStatePortFunc>();
		const dependencies = makeDependencies({
			buildStatePort,
			loadProject: fakeLoad({ data: { environments: { production: {} } }, success: true }),
		});

		await statePushCommand(dependencies)({ env: "production" });

		expect(buildStatePort).not.toHaveBeenCalled();
		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			"state not configured for environment 'production'",
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should report the config load failure and exit 1", async () => {
		expect.assertions(3);

		const readTextFile = vi.fn<ReadTextFileFunc>();
		const dependencies = makeDependencies({
			loadProject: fakeLoad({
				err: { kind: "fileNotFound", searchedFrom: PROJECT_ROOT },
				success: false,
			}),
			readTextFile,
		});

		await statePushCommand(dependencies)({ env: "production" });

		expect(readTextFile).not.toHaveBeenCalled();
		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("state push failed");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should report a parse error and exit 1 when a flag is unrecognized", async () => {
		expect.assertions(3);

		const loadProject = fakeLoad();
		const dependencies = makeDependencies({ loadProject });

		await statePushCommand(dependencies)({ env: "production", verbose: true });

		expect(loadProject).not.toHaveBeenCalled();
		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(expect.any(String));
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should default to process.exit when no exit slot is provided", async () => {
		expect.assertions(1);

		const exitSpy = vi.spyOn(process, "exit").mockImplementation(fromAny(() => {}));
		onTestFinished(() => {
			exitSpy.mockRestore();
		});

		await statePushCommand({ clack: fakeClackPort() })({});

		expect(exitSpy).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should forward --config to the project loader", async () => {
		expect.assertions(1);

		const loadProject = fakeLoad();
		const dependencies = makeDependencies({ loadProject });

		await statePushCommand(dependencies)({
			config: "./bedrock.staging.config.ts",
			env: "production",
		});

		expect(loadProject).toHaveBeenCalledExactlyOnceWith({
			configFile: "./bedrock.staging.config.ts",
		});
	});

	it("should pluralize the resource count it pushed", async () => {
		expect.assertions(1);

		const state: BedrockState = {
			environment: "production",
			resources: [passResource(), { ...passResource(), key: asResourceKey("alpha-pass") }],
			version: 1,
		};
		const dependencies = makeDependencies({
			readTextFile: fakeReadDump({ [DUMP_PATH]: serializeStateFile(state) }),
		});

		await statePushCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logSuccess).toHaveBeenCalledExactlyOnceWith(
			`production: 2 resources pushed from ${DUMP_PATH}, which has been removed`,
		);
	});
});
