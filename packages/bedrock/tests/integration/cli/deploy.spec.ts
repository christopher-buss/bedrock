import type { Result } from "@bedrock/ocale";

import { createProg, type ProgDeps } from "#src/cli/index";
import type { ConfigError } from "#src/core/config-error";
import type { Config } from "#src/core/schema";
import type { BedrockState } from "#src/core/state";
import type { DeployError, DeployOptions } from "#src/shell/deploy";
import type { LoadConfigOptions } from "#src/shell/load-config";
import { describe, expect, it, vi } from "vitest";

type LoadConfigFunc = (options?: LoadConfigOptions) => Promise<Result<Config, ConfigError>>;
type DeployFunc = (options: DeployOptions) => Promise<Result<BedrockState, DeployError>>;

const fakeConfig: Config = {
	environments: { production: {}, staging: {} },
};

interface DeployHarness {
	readonly deploy: ReturnType<typeof vi.fn<DeployFunc>>;
	readonly exitPromise: Promise<number>;
	readonly loadConfig: ReturnType<typeof vi.fn<LoadConfigFunc>>;
	readonly prog: ReturnType<typeof createProg>;
}

type ClackPort = NonNullable<ProgDeps["clack"]>;

function emptyState(environment: string): BedrockState {
	return { environment, resources: [], version: 1 };
}

function silentClack(): ClackPort {
	return {
		cancel: vi.fn<ClackPort["cancel"]>(),
		intro: vi.fn<ClackPort["intro"]>(),
		logError: vi.fn<ClackPort["logError"]>(),
		logMessage: vi.fn<ClackPort["logMessage"]>(),
		logSuccess: vi.fn<ClackPort["logSuccess"]>(),
		outro: vi.fn<ClackPort["outro"]>(),
	};
}

function buildHarness(
	deployResults: ReadonlyArray<Result<BedrockState, DeployError>>,
): DeployHarness {
	let resolveExit!: (code: number) => void;
	const exitPromise = new Promise<number>((resolve) => {
		resolveExit = resolve;
	});
	const exit = vi.fn<(code: number) => never>().mockImplementation(((code: number) => {
		resolveExit(code);
	}) as (code: number) => never);

	let callIndex = 0;
	const deploy = vi.fn<DeployFunc>(async () => {
		const next = deployResults[callIndex];
		callIndex += 1;
		if (next === undefined) {
			throw new Error("deploy invoked beyond scripted results");
		}

		return next;
	});
	const loadConfig = vi.fn<LoadConfigFunc>(async () => ({ data: fakeConfig, success: true }));

	const prog = createProg({ clack: silentClack(), deploy, exit, loadConfig });
	return { deploy, exitPromise, loadConfig, prog };
}

function dispatch(prog: ReturnType<typeof createProg>, argv: ReadonlyArray<string>): void {
	prog.parse(["node", "bedrock", ...argv]);
}

describe("cli deploy dispatch", () => {
	it("should route 'deploy --env production --config ./b.config.ts' through the action with the parsed options", async () => {
		expect.assertions(3);

		const harness = buildHarness([{ data: emptyState("production"), success: true }]);

		dispatch(harness.prog, [
			"deploy",
			"--env",
			"production",
			"--config",
			"./bedrock.staging.config.ts",
		]);
		const code = await harness.exitPromise;

		expect(harness.loadConfig).toHaveBeenCalledExactlyOnceWith({
			configFile: "./bedrock.staging.config.ts",
		});
		expect(harness.deploy).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ config: fakeConfig, environment: "production" }),
		);
		expect(code).toBe(0);
	});

	it("should call deploy once per --env and exit 1 when any env fails", async () => {
		expect.assertions(2);

		const harness = buildHarness([
			{ data: emptyState("production"), success: true },
			{
				err: { environment: "staging", kind: "stateNotConfigured" },
				success: false,
			},
		]);

		dispatch(harness.prog, ["deploy", "--env", "production", "--env", "staging"]);
		const code = await harness.exitPromise;

		expect(harness.deploy).toHaveBeenCalledTimes(2);
		expect(code).toBe(1);
	});
});
