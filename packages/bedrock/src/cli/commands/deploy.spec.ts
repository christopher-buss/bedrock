import type { Result } from "@bedrock/ocale";

import { describe, expect, it, vi } from "vitest";

import type { ConfigError } from "../../core/config-error.ts";
import type { ResourceCurrentState } from "../../core/resources.ts";
import type { Config } from "../../core/schema.ts";
import type { BedrockState } from "../../core/state.ts";
import type { DeployError, DeployOptions } from "../../shell/deploy.ts";
import type { LoadConfigOptions } from "../../shell/load-config.ts";
import { asResourceKey, asRobloxAssetId, asSha256Hex } from "../../types/ids.ts";
import type { ProgDeps } from "../index.ts";
import type { ClackPort } from "../render.ts";
import { deployCommand } from "./deploy.ts";

type LoadConfigFunc = (options?: LoadConfigOptions) => Promise<Result<Config, ConfigError>>;
type DeployFunc = (options: DeployOptions) => Promise<Result<BedrockState, DeployError>>;

function fakeClackPort(): ClackPort {
	return {
		cancel: vi.fn<ClackPort["cancel"]>(),
		intro: vi.fn<ClackPort["intro"]>(),
		logError: vi.fn<ClackPort["logError"]>(),
		logMessage: vi.fn<ClackPort["logMessage"]>(),
		logSuccess: vi.fn<ClackPort["logSuccess"]>(),
		outro: vi.fn<ClackPort["outro"]>(),
	};
}

function makeDeps(overrides: Partial<ProgDeps> = {}): ProgDeps {
	return {
		clack: fakeClackPort(),
		exit: vi.fn<(code: number) => never>(),
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
		iconFileHash: SAMPLE_HASH,
		iconFilePath: "assets/icon.png",
		kind: "gamePass",
		outputs: {
			assetId: asRobloxAssetId(String(1_000_000 + suffix)),
			iconAssetId: asRobloxAssetId(String(2_000_000 + suffix)),
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

function fakeLoad(result: Result<Config, ConfigError>): LoadConfigFunc {
	return vi.fn<LoadConfigFunc>(async () => result);
}

function fakeDeploy(mapping: ReadonlyArray<Result<BedrockState, DeployError>>): DeployFunc {
	let callIndex = 0;
	return vi.fn<DeployFunc>(async () => {
		const next = mapping[callIndex];
		callIndex += 1;
		if (next === undefined) {
			throw new Error("fakeDeploy invoked with no scripted result");
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

		const deps = makeDeps();

		await deployCommand(deps)(rawOptions);

		expect(deps.clack?.intro).toHaveBeenCalledExactlyOnceWith("bedrock deploy");
		expect(deps.clack?.logError).toHaveBeenCalledOnce();
		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("deploy failed");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should render configLoadFailed and exit 1 when loadConfig returns Err", async () => {
		expect.assertions(3);

		const loadConfig = fakeLoad({
			err: { kind: "fileNotFound", searchedFrom: "/tmp/project" },
			success: false,
		});
		const deps = makeDeps({ deploy: vi.fn<DeployFunc>(), loadConfig });

		await deployCommand(deps)({ env: "production" });

		expect(deps.clack?.logError).toHaveBeenCalledOnce();
		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("deploy failed");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should forward parsed configFile to loadConfig", async () => {
		expect.assertions(1);

		const loadConfig = fakeLoad({ data: sampleConfig, success: true });
		const deploy = fakeDeploy([{ data: bedrockState("production"), success: true }]);
		const deps = makeDeps({ deploy, loadConfig });

		await deployCommand(deps)({ config: "./bedrock.staging.config.ts", env: "production" });

		expect(loadConfig).toHaveBeenCalledExactlyOnceWith({
			configFile: "./bedrock.staging.config.ts",
		});
	});

	it("should call loadConfig with no options when --config is absent", async () => {
		expect.assertions(1);

		const loadConfig = fakeLoad({ data: sampleConfig, success: true });
		const deploy = fakeDeploy([{ data: bedrockState("production"), success: true }]);
		const deps = makeDeps({ deploy, loadConfig });

		await deployCommand(deps)({ env: "production" });

		expect(loadConfig).toHaveBeenCalledExactlyOnceWith(undefined);
	});

	it("should dispatch deploy with the loaded config and env, then log success and exit 0", async () => {
		expect.assertions(4);

		const loadConfig = fakeLoad({ data: sampleConfig, success: true });
		const deploy = fakeDeploy([{ data: bedrockState("production", 3), success: true }]);
		const deps = makeDeps({ deploy, loadConfig });

		await deployCommand(deps)({ env: "production" });

		expect(deploy).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ config: sampleConfig, environment: "production" }),
		);
		expect(deps.clack?.logSuccess).toHaveBeenCalledExactlyOnceWith(
			"production: 3 resources reconciled",
		);
		expect(deps.clack?.outro).toHaveBeenCalledExactlyOnceWith("deploy succeeded");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should render the DeployError and exit 1 when deploy returns Err", async () => {
		expect.assertions(3);

		const loadConfig = fakeLoad({ data: sampleConfig, success: true });
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
		const deps = makeDeps({ deploy, loadConfig });

		await deployCommand(deps)({ env: "ghost" });

		expect(deps.clack?.logError).toHaveBeenCalledOnce();
		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("deploy failed");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should dispatch deploy once per --env in order and exit 0 when all succeed", async () => {
		expect.assertions(3);

		const loadConfig = fakeLoad({ data: sampleConfig, success: true });
		const deploy = fakeDeploy([
			{ data: bedrockState("production", 1), success: true },
			{ data: bedrockState("staging", 2), success: true },
		]);
		const deps = makeDeps({ deploy, loadConfig });

		await deployCommand(deps)({ env: ["production", "staging"] });

		expect(deploy).toHaveBeenCalledTimes(2);
		expect(deps.clack?.outro).toHaveBeenCalledExactlyOnceWith("deploy succeeded");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should call deploy for every env even when one fails, then exit 1", async () => {
		expect.assertions(4);

		const loadConfig = fakeLoad({ data: sampleConfig, success: true });
		const deploy = fakeDeploy([
			{
				err: { environment: "production", kind: "stateNotConfigured" },
				success: false,
			},
			{ data: bedrockState("staging", 5), success: true },
		]);
		const deps = makeDeps({ deploy, loadConfig });

		await deployCommand(deps)({ env: ["production", "staging"] });

		expect(deploy).toHaveBeenCalledTimes(2);
		expect(deps.clack?.logSuccess).toHaveBeenCalledExactlyOnceWith(
			"staging: 5 resources reconciled",
		);
		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("deploy failed");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});
});
