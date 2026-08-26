import type { Result } from "@bedrock-rbx/ocale";
import { fromAny } from "@total-typescript/shoehorn";

import { type } from "arktype";
import process from "node:process";
import { assert, describe, expect, it, onTestFinished, vi } from "vitest";

import { fakeClackPort } from "#tests/helpers/clack";
import { fakeStateBackendPlugins } from "#tests/helpers/plugins";
import { resultsInOrder } from "#tests/helpers/sequence";
import type { ConfigError } from "../../core/config-error.ts";
import { EMPTY_PLUGIN_REGISTRY, type PluginRegistry } from "../../core/plugin-registry.ts";
import type { ResourceCurrentState } from "../../core/resources.ts";
import type { Config } from "../../core/schema.ts";
import type { BedrockState } from "../../core/state.ts";
import type { ProgressEvent, ProgressPort } from "../../ports/progress-port.ts";
import type { DeployError } from "../../shell/deploy.ts";
import { asResourceKey, asRobloxAssetId, asSha256Hex } from "../../types/ids.ts";
import type { ProgDeps as ProgDependencies } from "../index.ts";
import type { Spawner, SpawnInvocation, SpawnLaunchError } from "../spawner.ts";
import { deployCommand } from "./deploy.ts";

type LoadProjectFunc = NonNullable<ProgDependencies["loadProject"]>;
type DeployFunc = NonNullable<ProgDependencies["deploy"]>;
type ExitFunc = NonNullable<ProgDependencies["exit"]>;
type DiscoverOverrideFunc = NonNullable<ProgDependencies["discoverOverride"]>;

interface SpawnerRecorder {
	readonly invocations: ReadonlyArray<SpawnInvocation>;
	readonly spawner: Spawner;
}

function recordingSpawner(result: Result<number, SpawnLaunchError>): SpawnerRecorder {
	const invocations: Array<SpawnInvocation> = [];
	const spawner: Spawner = {
		async spawn(invocation) {
			invocations.push(invocation);
			return result;
		},
	};
	return { invocations, spawner };
}

function discoverReturning(path: string | undefined): DiscoverOverrideFunc {
	return vi.fn<DiscoverOverrideFunc>(() => path);
}

function discoverByCommand(
	mapping: Readonly<Record<string, string | undefined>>,
): DiscoverOverrideFunc {
	return vi.fn<DiscoverOverrideFunc>((_root, command) => mapping[command]);
}

/**
 * Build a discovery fake that throws for one command and resolves nothing for
 * every other, so a test states which lookup fails as data.
 *
 * @param failing - The command whose discovery throws.
 * @param message - The thrown error message.
 * @returns The discovery fake.
 */
function discoverThrowingFor(failing: string, message: string): DiscoverOverrideFunc {
	const thrown = new Error(message);
	const byCommand: Readonly<Record<string, () => string | undefined>> = {
		[failing]: () => {
			throw thrown;
		},
	};
	return vi.fn<DiscoverOverrideFunc>((_root, command) => byCommand[command]?.());
}

function makeDependencies(overrides: Partial<ProgDependencies> = {}): ProgDependencies {
	return {
		clack: fakeClackPort(),
		exit: vi.fn<ExitFunc>(),
		...overrides,
	};
}

const sampleConfig: Config = { environments: { production: {}, staging: {} } };

const SAMPLE_HASH = asSha256Hex("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

function gamePassResource(suffix: number): ResourceCurrentState {
	return {
		key: asResourceKey(`pass-${String(suffix)}`),
		name: `Pass ${String(suffix)}`,
		description: "Sample pass.",
		icon: { "en-us": "assets/icon.png" },
		iconFileHashes: { "en-us": SAMPLE_HASH },
		kind: "gamePass",
		outputs: {
			assetId: asRobloxAssetId(String(1_000_000 + suffix)),
			iconAssetIds: { "en-us": asRobloxAssetId(String(2_000_000 + suffix)) },
		},
		price: undefined,
	};
}

function bedrockState(environment: string, resourceCount = 0): BedrockState {
	const resources: ReadonlyArray<ResourceCurrentState> = Array.from(
		{ length: resourceCount },
		(_, index) => gamePassResource(index),
	);
	return { environment, resources, version: 1 };
}

/**
 * A project loader answering with one canned config, or with the load
 * failure a test scripted. Call sites state the config, so what the
 * plugins declared stays out of the way until a test cares.
 *
 * @param result - The config to load, or the failure to report.
 * @param plugins - What the load should report the plugins declared.
 * @returns The loader to inject.
 */
function fakeLoad(
	result: Result<Config, ConfigError>,
	plugins: PluginRegistry = EMPTY_PLUGIN_REGISTRY,
): LoadProjectFunc {
	return vi.fn<LoadProjectFunc>(async () => {
		return result.success ? { data: { config: result.data, plugins }, success: true } : result;
	});
}

function fakeDeploy(mapping: ReadonlyArray<Result<BedrockState, DeployError>>): DeployFunc {
	let callIndex = 0;
	return vi.fn<DeployFunc>(async (options) => {
		const next = mapping[callIndex];
		callIndex += 1;
		if (next === undefined) {
			throw new Error("fakeDeploy invoked with no scripted result");
		}

		if (next.success) {
			options.progress?.emit({
				environment: options.environment,
				kind: "deploySuccess",
				resourceCount: next.data.resources.length,
			});
		} else {
			options.progress?.emit({
				environment: options.environment,
				error: next.err,
				kind: "deployFailure",
			});
		}

		return next;
	});
}

describe(deployCommand, () => {
	it.for<{ label: string; rawOptions: Record<string, unknown> }>([
		{ label: "missingRequired", rawOptions: {} },
		{ label: "unknownFlag", rawOptions: { env: "production", verbose: true } },
		{ label: "invalidValue", rawOptions: { env: false } },
	])("should surface a $label parse error and exit with code 1", async ({ rawOptions }) => {
		expect.assertions(4);

		onTestFinished(() => {
			vi.unstubAllEnvs();
		});
		vi.stubEnv("BEDROCK_ENVIRONMENT", undefined);

		const dependencies = makeDependencies();

		await deployCommand(dependencies)(rawOptions);

		expect(dependencies.clack!.intro).toHaveBeenCalledExactlyOnceWith("bedrock deploy");
		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(expect.any(String));
		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("deploy failed");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should render configLoadFailed and exit 1 when loadProject returns Err", async () => {
		expect.assertions(3);

		const loadProject = fakeLoad({
			err: { kind: "fileNotFound", searchedFrom: "/tmp/project" },
			success: false,
		});
		const dependencies = makeDependencies({ deploy: vi.fn<DeployFunc>(), loadProject });

		await deployCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(expect.any(String));
		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("deploy failed");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should hand deploy what the project load registered, so a plugin backend resolves", async () => {
		expect.assertions(1);

		const plugins = fakeStateBackendPlugins({
			name: "s3",
			createPort: () => ({ err: { reason: "unused in this test" }, success: false }),
			schema: type({ bucket: "string > 0" }),
			specifier: "@example/state-s3",
		});
		const loadProject = fakeLoad({ data: sampleConfig, success: true }, plugins);
		const seen: Array<unknown> = [];
		const deploy = vi.fn<DeployFunc>(async (options) => {
			seen.push(options.plugins);
			return { data: bedrockState("production"), success: true };
		});

		await deployCommand(makeDependencies({ deploy, loadProject }))({ env: "production" });

		expect(seen).toStrictEqual([plugins]);
	});

	it("should forward parsed configFile to loadProject", async () => {
		expect.assertions(1);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const deploy = fakeDeploy([{ data: bedrockState("production"), success: true }]);
		const dependencies = makeDependencies({ deploy, loadProject });

		await deployCommand(dependencies)({
			config: "./bedrock.staging.config.ts",
			env: "production",
		});

		expect(loadProject).toHaveBeenCalledExactlyOnceWith({
			configFile: "./bedrock.staging.config.ts",
		});
	});

	it("should call loadProject with no options when --config is absent", async () => {
		expect.assertions(1);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const deploy = fakeDeploy([{ data: bedrockState("production"), success: true }]);
		const dependencies = makeDependencies({ deploy, loadProject });

		await deployCommand(dependencies)({ env: "production" });

		expect(loadProject).toHaveBeenCalledExactlyOnceWith(undefined);
	});

	it("should dispatch deploy with the loaded config and env, then log success and exit 0", async () => {
		expect.assertions(4);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const deploy = fakeDeploy([{ data: bedrockState("production", 3), success: true }]);
		const dependencies = makeDependencies({ deploy, loadProject });

		await deployCommand(dependencies)({ env: "production" });

		expect(deploy).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ config: sampleConfig, environment: "production" }),
		);
		expect(dependencies.clack!.logSuccess).toHaveBeenCalledExactlyOnceWith(
			"production: 3 resources reconciled",
		);
		expect(dependencies.clack!.outro).toHaveBeenCalledExactlyOnceWith("deploy succeeded");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should render the DeployError and exit 1 when deploy returns Err", async () => {
		expect.assertions(3);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const deploy = fakeDeploy([
			{
				err: {
					declared: ["production"],
					environment: "ghost",
					kind: "unknownEnvironment",
				},
				success: false,
			},
		]);
		const dependencies = makeDependencies({ deploy, loadProject });

		await deployCommand(dependencies)({ env: "ghost" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(expect.any(String));
		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("deploy failed");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should dispatch deploy once per --env in order and exit 0 when all succeed", async () => {
		expect.assertions(3);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const deploy = fakeDeploy([
			{ data: bedrockState("production", 1), success: true },
			{ data: bedrockState("staging", 2), success: true },
		]);
		const dependencies = makeDependencies({ deploy, loadProject });

		await deployCommand(dependencies)({ env: ["production", "staging"] });

		expect(deploy).toHaveBeenCalledTimes(2);
		expect(dependencies.clack!.outro).toHaveBeenCalledExactlyOnceWith("deploy succeeded");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should call deploy for every env even when one fails, then exit 1", async () => {
		expect.assertions(4);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const deploy = fakeDeploy([
			{
				err: { environment: "production", kind: "stateNotConfigured" },
				success: false,
			},
			{ data: bedrockState("staging", 5), success: true },
		]);
		const dependencies = makeDependencies({ deploy, loadProject });

		await deployCommand(dependencies)({ env: ["production", "staging"] });

		expect(deploy).toHaveBeenCalledTimes(2);
		expect(dependencies.clack!.logSuccess).toHaveBeenCalledExactlyOnceWith(
			"staging: 5 resources reconciled",
		);
		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("deploy failed");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should thread --api-key and --github-token through getEnv into deploy", async () => {
		expect.assertions(4);

		vi.stubEnv("UNRELATED_VAR", "from-process-unrelated");
		onTestFinished(() => {
			vi.unstubAllEnvs();
		});

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const deploy = fakeDeploy([{ data: bedrockState("production"), success: true }]);
		const dependencies = makeDependencies({ deploy, loadProject });

		await deployCommand(dependencies)({
			"api-key": "BEDROCK_OVERRIDE",
			"env": "production",
			"github-token": "GH_OVERRIDE",
		});

		expect(deploy).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ config: sampleConfig, environment: "production" }),
		);

		const firstCall = vi.mocked(deploy).mock.calls[0];
		assert(firstCall !== undefined);

		const [call] = firstCall;

		expect(call.getEnv!("BEDROCK_API_KEY")).toBe("BEDROCK_OVERRIDE");
		expect(call.getEnv!("BEDROCK_GITHUB_TOKEN")).toBe("GH_OVERRIDE");
		expect(call.getEnv!("UNRELATED_VAR")).toBe("from-process-unrelated");
	});

	it("should overlay each credential flag only on its named slot, not the other", async () => {
		expect.assertions(3);

		vi.stubEnv("BEDROCK_API_KEY", "from-process-bedrock");
		vi.stubEnv("BEDROCK_GITHUB_TOKEN", "from-process-github");
		onTestFinished(() => {
			vi.unstubAllEnvs();
		});

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const deploy = fakeDeploy([{ data: bedrockState("production"), success: true }]);
		const dependencies = makeDependencies({ deploy, loadProject });

		await deployCommand(dependencies)({ "api-key": "FLAG_BEDROCK", "env": "production" });

		const firstCall = vi.mocked(deploy).mock.calls[0];
		assert(firstCall !== undefined);

		const [call] = firstCall;

		expect(call.getEnv!("BEDROCK_API_KEY")).toBe("FLAG_BEDROCK");
		expect(call.getEnv!("BEDROCK_GITHUB_TOKEN")).toBe("from-process-github");
		expect(call.getEnv!("UNRELATED_VAR")).toBeUndefined();
	});

	it("should fall back to process.env when neither --api-key nor --github-token is supplied", async () => {
		expect.assertions(2);

		vi.stubEnv("BEDROCK_API_KEY", "process-bedrock");
		vi.stubEnv("BEDROCK_GITHUB_TOKEN", "process-github");
		onTestFinished(() => {
			vi.unstubAllEnvs();
		});

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const deploy = fakeDeploy([{ data: bedrockState("production"), success: true }]);
		const dependencies = makeDependencies({ deploy, loadProject });

		await deployCommand(dependencies)({ env: "production" });

		const firstCall = vi.mocked(deploy).mock.calls[0];
		assert(firstCall !== undefined);

		const [call] = firstCall;

		expect(call.getEnv!("BEDROCK_API_KEY")).toBe("process-bedrock");
		expect(call.getEnv!("BEDROCK_GITHUB_TOKEN")).toBe("process-github");
	});

	it("should deploy with BEDROCK_ENVIRONMENT when --env is omitted", async () => {
		expect.assertions(2);

		onTestFinished(() => {
			vi.unstubAllEnvs();
		});
		vi.stubEnv("BEDROCK_ENVIRONMENT", "production");

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const deploy = fakeDeploy([{ data: bedrockState("production"), success: true }]);
		const dependencies = makeDependencies({ deploy, loadProject });

		await deployCommand(dependencies)({});

		expect(deploy).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ config: sampleConfig, environment: "production" }),
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it.for<{
		deployResult: Result<BedrockState, DeployError>;
		env: string;
		expectedEvent: ProgressEvent;
		label: string;
	}>([
		{
			deployResult: { data: bedrockState("production", 3), success: true },
			env: "production",
			expectedEvent: { environment: "production", kind: "deploySuccess", resourceCount: 3 },
			label: "deploySuccess",
		},
		{
			deployResult: {
				err: { declared: ["production"], environment: "ghost", kind: "unknownEnvironment" },
				success: false,
			},
			env: "ghost",
			expectedEvent: {
				environment: "ghost",
				error: {
					declared: ["production"],
					environment: "ghost",
					kind: "unknownEnvironment",
				},
				kind: "deployFailure",
			},
			label: "deployFailure",
		},
	])(
		"should emit a $label event to an injected progress port",
		async ({ deployResult, env, expectedEvent }) => {
			expect.assertions(1);

			let events: ReadonlyArray<ProgressEvent> = [];
			const progress: ProgressPort = {
				emit(event) {
					events = [...events, event];
				},
			};
			const loadProject = fakeLoad({ data: sampleConfig, success: true });
			const deploy = fakeDeploy([deployResult]);
			const dependencies = makeDependencies({ deploy, loadProject, progress });

			await deployCommand(dependencies)({ env });

			expect(events).toStrictEqual([expectedEvent]);
		},
	);

	it("should default to process.exit when no exit slot is provided", async () => {
		expect.assertions(1);

		const exitSpy = vi.spyOn(process, "exit").mockImplementation(fromAny(() => {}));
		onTestFinished(() => {
			exitSpy.mockRestore();
		});

		await deployCommand({ clack: fakeClackPort() })({});

		expect(exitSpy).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should thread the injected progress port into the underlying deploy() call", async () => {
		expect.assertions(1);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const deploy = fakeDeploy([{ data: bedrockState("production", 0), success: true }]);
		const progress: ProgressPort = { emit: vi.fn<ProgressPort["emit"]>() };
		const dependencies = makeDependencies({ deploy, loadProject, progress });

		await deployCommand(dependencies)({ env: "production" });

		expect(deploy).toHaveBeenCalledWith(expect.objectContaining({ progress }));
	});

	it("should render stateWritten through the default clack adapter with the loaded config's state label", async () => {
		expect.assertions(1);

		const configWithGist: Config = {
			environments: { production: {} },
			state: { backend: "gist", gistId: "abc-test" },
		};
		const clack = fakeClackPort();
		const loadProject = fakeLoad({ data: configWithGist, success: true });
		const deploy = vi.fn<DeployFunc>(async (options) => {
			options.progress!.emit({ environment: "production", kind: "stateWritten" });
			return { data: bedrockState("production", 0), success: true };
		});
		const dependencies = makeDependencies({ clack, deploy, loadProject });

		await deployCommand(dependencies)({ env: "production" });

		expect(clack.logMessage).toHaveBeenCalledWith("State written to gist:abc-test");
	});

	it("should dispatch the spawner instead of deploy() when an override is discovered", async () => {
		expect.assertions(3);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const deploy = vi.fn<DeployFunc>();
		const { invocations, spawner } = recordingSpawner({ data: 0, success: true });
		const discoverOverride = discoverReturning("/abs/.bedrock/deploy.ts");
		const dependencies = makeDependencies({
			deploy,
			discoverOverride,
			loadProject,
			projectRoot: "/project",
			spawner,
		});

		await deployCommand(dependencies)({ env: "production" });

		expect(invocations).toHaveLength(1);
		expect(deploy).not.toHaveBeenCalled();
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should query discoverOverride with the configured projectRoot and the 'deploy' command name", async () => {
		expect.assertions(1);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const deploy = fakeDeploy([{ data: bedrockState("production"), success: true }]);
		const discoverOverride = discoverReturning(undefined);
		const dependencies = makeDependencies({
			deploy,
			discoverOverride,
			loadProject,
			projectRoot: "/abs/project",
		});

		await deployCommand(dependencies)({ env: "production" });

		expect(discoverOverride).toHaveBeenNthCalledWith(1, "/abs/project", "deploy");
	});

	it("should forward the discovered override path and parsed flags into the spawned invocation", async () => {
		expect.assertions(4);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const { invocations, spawner } = recordingSpawner({ data: 0, success: true });
		const discoverOverride = discoverReturning("/abs/.bedrock/deploy.ts");
		const dependencies = makeDependencies({
			discoverOverride,
			loadProject,
			projectRoot: "/abs",
			spawner,
		});

		await deployCommand(dependencies)({
			"api-key": "rbx-key",
			"config": "./bedrock.staging.config.ts",
			"env": "production",
			"github-token": "ghp-token",
		});

		const { args } = invocations[0]!;

		expect(args).toStrictEqual([
			"/abs/.bedrock/deploy.ts",
			"--env",
			"production",
			"--config",
			"./bedrock.staging.config.ts",
		]);
		expect(invocations[0]!.envOverrides).toMatchObject({
			BEDROCK_API_KEY: "rbx-key",
			BEDROCK_CLI: "1",
			BEDROCK_GITHUB_TOKEN: "ghp-token",
		});
		expect(args).not.toContain("rbx-key");
		expect(args).not.toContain("ghp-token");
	});

	it("should dispatch the spawner once per --env when multiple environments are requested", async () => {
		expect.assertions(3);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const { invocations, spawner } = recordingSpawner({ data: 0, success: true });
		const discoverOverride = discoverReturning("/abs/.bedrock/deploy.ts");
		const dependencies = makeDependencies({
			discoverOverride,
			loadProject,
			projectRoot: "/abs",
			spawner,
		});

		await deployCommand(dependencies)({ env: ["production", "staging"] });

		expect(invocations).toHaveLength(2);

		const environmentValues = invocations.map(({ args }) => args[args.indexOf("--env") + 1]);

		expect(environmentValues).toStrictEqual(["production", "staging"]);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should fall back to the shell deploy() when discoverOverride returns undefined", async () => {
		expect.assertions(2);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const deploy = fakeDeploy([{ data: bedrockState("production"), success: true }]);
		const { invocations, spawner } = recordingSpawner({ data: 0, success: true });
		const discoverOverride = discoverReturning(undefined);
		const dependencies = makeDependencies({ deploy, discoverOverride, loadProject, spawner });

		await deployCommand(dependencies)({ env: "production" });

		expect(deploy).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ config: sampleConfig, environment: "production" }),
		);
		expect(invocations).toHaveLength(0);
	});

	it("should cancel and exit 1 when an override spawn returns a non-zero exit code", async () => {
		expect.assertions(3);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const { spawner } = recordingSpawner({ data: 3, success: true });
		const discoverOverride = discoverReturning("/abs/.bedrock/deploy.ts");
		const dependencies = makeDependencies({ discoverOverride, loadProject, spawner });

		await deployCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			"production: override exited with code 3",
		);
		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("deploy failed");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should log a launch failure via clack and exit 1 when the override spawn cannot start", async () => {
		expect.assertions(3);

		const cause: Error & { code?: string } = Object.assign(new Error("spawn bun ENOENT"), {
			code: "ENOENT",
		});
		const { spawner } = recordingSpawner({
			err: { cause, kind: "launchFailed" },
			success: false,
		});
		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const discoverOverride = discoverReturning("/abs/.bedrock/deploy.ts");
		const dependencies = makeDependencies({ discoverOverride, loadProject, spawner });

		await deployCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			"production: failed to launch override - spawn bun ENOENT",
		);
		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("deploy failed");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should run every env via spawn even when an earlier env's spawn exits non-zero", async () => {
		expect.assertions(2);

		const invocations: Array<SpawnInvocation> = [];
		const results = resultsInOrder<Result<number, SpawnLaunchError>>([
			{ data: 3, success: true },
			{ data: 0, success: true },
		]);
		const spawner: Spawner = {
			async spawn(invocation) {
				invocations.push(invocation);
				return results();
			},
		};
		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const discoverOverride = discoverReturning("/abs/.bedrock/deploy.ts");
		const dependencies = makeDependencies({ discoverOverride, loadProject, spawner });

		await deployCommand(dependencies)({ env: ["production", "staging"] });

		expect(invocations).toHaveLength(2);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should inject a build step that spawns the discovered .bedrock/build.ts override", async () => {
		expect.assertions(4);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const deploy = fakeDeploy([{ data: bedrockState("production"), success: true }]);
		const { invocations, spawner } = recordingSpawner({ data: 0, success: true });
		const discoverOverride = discoverByCommand({ build: "/abs/.bedrock/build.ts" });
		const dependencies = makeDependencies({
			deploy,
			discoverOverride,
			loadProject,
			projectRoot: "/abs",
			spawner,
		});

		await deployCommand(dependencies)({ "api-key": "rbx-key", "env": "production" });

		const firstCall = vi.mocked(deploy).mock.calls[0];
		assert(firstCall !== undefined);

		const [call] = firstCall;
		assert(call.build !== undefined);

		expect(invocations).toHaveLength(0);

		await call.build({ environment: "production" });

		expect(invocations).toHaveLength(1);
		expect(invocations[0]!.args).toStrictEqual([
			"/abs/.bedrock/build.ts",
			"--env",
			"production",
		]);
		expect(invocations[0]!.envOverrides).toMatchObject({
			BEDROCK_API_KEY: "rbx-key",
			BEDROCK_CLI: "1",
		});
	});

	it("should leave the build step undefined when no .bedrock/build.ts override exists", async () => {
		expect.assertions(1);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const deploy = fakeDeploy([{ data: bedrockState("production"), success: true }]);
		const discoverOverride = discoverByCommand({});
		const dependencies = makeDependencies({ deploy, discoverOverride, loadProject });

		await deployCommand(dependencies)({ env: "production" });

		const firstCall = vi.mocked(deploy).mock.calls[0];
		assert(firstCall !== undefined);

		expect(firstCall[0].build).toBeUndefined();
	});

	it("should reject from the injected build step when the spawned build exits non-zero", async () => {
		expect.assertions(1);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const deploy = fakeDeploy([{ data: bedrockState("production"), success: true }]);
		const { spawner } = recordingSpawner({ data: 3, success: true });
		const discoverOverride = discoverByCommand({ build: "/abs/.bedrock/build.ts" });
		const dependencies = makeDependencies({ deploy, discoverOverride, loadProject, spawner });

		await deployCommand(dependencies)({ env: "production" });

		const firstCall = vi.mocked(deploy).mock.calls[0];
		assert(firstCall !== undefined);
		assert(firstCall[0].build !== undefined);

		await expect(firstCall[0].build({ environment: "production" })).rejects.toThrow(
			".bedrock/build.ts exited with code 3",
		);
	});

	it("should reject from the injected build step when the spawned build cannot launch", async () => {
		expect.assertions(1);

		const cause: Error & { code?: string } = Object.assign(new Error("spawn bun ENOENT"), {
			code: "ENOENT",
		});
		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const deploy = fakeDeploy([{ data: bedrockState("production"), success: true }]);
		const { spawner } = recordingSpawner({
			err: { cause, kind: "launchFailed" },
			success: false,
		});
		const discoverOverride = discoverByCommand({ build: "/abs/.bedrock/build.ts" });
		const dependencies = makeDependencies({ deploy, discoverOverride, loadProject, spawner });

		await deployCommand(dependencies)({ env: "production" });

		const firstCall = vi.mocked(deploy).mock.calls[0];
		assert(firstCall !== undefined);
		assert(firstCall[0].build !== undefined);

		await expect(firstCall[0].build({ environment: "production" })).rejects.toMatchObject({
			cause,
			message: "failed to launch .bedrock/build.ts",
		});
	});

	it("should discover the build override alongside the deploy override on the shell path", async () => {
		expect.assertions(3);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const deploy = fakeDeploy([{ data: bedrockState("production"), success: true }]);
		const discoverOverride = discoverByCommand({});
		const dependencies = makeDependencies({
			deploy,
			discoverOverride,
			loadProject,
			projectRoot: "/abs/project",
		});

		await deployCommand(dependencies)({ env: "production" });

		expect(discoverOverride).toHaveBeenCalledTimes(2);
		expect(discoverOverride).toHaveBeenNthCalledWith(1, "/abs/project", "deploy");
		expect(discoverOverride).toHaveBeenNthCalledWith(2, "/abs/project", "build");
	});

	it("should not discover a build override when a .bedrock/deploy.ts override is dispatched", async () => {
		expect.assertions(1);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const { spawner } = recordingSpawner({ data: 0, success: true });
		const discoverOverride = discoverByCommand({ deploy: "/abs/.bedrock/deploy.ts" });
		const dependencies = makeDependencies({
			discoverOverride,
			loadProject,
			projectRoot: "/abs",
			spawner,
		});

		await deployCommand(dependencies)({ env: "production" });

		expect(discoverOverride).toHaveBeenCalledExactlyOnceWith("/abs", "deploy");
	});

	it("should render an error and exit 1 when build override discovery throws", async () => {
		expect.assertions(4);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const deploy = vi.fn<DeployFunc>();
		const discoverOverride = discoverThrowingFor(
			"build",
			"EACCES: permission denied, stat '/project/.bedrock/build.ts'",
		);
		const dependencies = makeDependencies({
			deploy,
			discoverOverride,
			loadProject,
			projectRoot: "/project",
		});

		await deployCommand(dependencies)({ env: "production" });

		expect(deploy).not.toHaveBeenCalled();
		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			"override discovery failed: EACCES: permission denied, stat '/project/.bedrock/build.ts'",
		);
		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("deploy failed");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should render an error and exit 1 when discoverOverride throws", async () => {
		expect.assertions(3);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const deploy = vi.fn<DeployFunc>();
		const discoverOverride = vi.fn<DiscoverOverrideFunc>(() => {
			throw new Error("EACCES: permission denied, stat '/project/.bedrock/deploy.ts'");
		});
		const dependencies = makeDependencies({
			deploy,
			discoverOverride,
			loadProject,
			projectRoot: "/project",
		});

		await deployCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			"override discovery failed: EACCES: permission denied, stat '/project/.bedrock/deploy.ts'",
		);
		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("deploy failed");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});
});
