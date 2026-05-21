import type { Result } from "@bedrock-rbx/ocale";

import { createProg, type ProgDeps } from "#src/cli/index";
import type { Config } from "#src/core/schema";
import type { BedrockState } from "#src/core/state";
import type { DeployError } from "#src/shell/deploy";
import { fakeClackPort } from "#tests/helpers/clack";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

type LoadConfigFunc = NonNullable<ProgDeps["loadConfig"]>;
type DeployFunc = NonNullable<ProgDeps["deploy"]>;
type ExitFunc = NonNullable<ProgDeps["exit"]>;
type DiscoverOverrideFunc = NonNullable<ProgDeps["discoverOverride"]>;

const fakeConfig: Config = {
	environments: { production: {}, staging: {} },
};

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "overrides");
const EXIT_ZERO = join(FIXTURES_ROOT, "exit-zero.ts");
const EXIT_NON_ZERO = join(FIXTURES_ROOT, "exit-non-zero.ts");

interface DeployHarness {
	readonly clack: NonNullable<ProgDeps["clack"]>;
	readonly deploy: ReturnType<typeof vi.fn<DeployFunc>>;
	readonly exitPromise: Promise<number>;
	readonly loadConfig: ReturnType<typeof vi.fn<LoadConfigFunc>>;
	readonly prog: ReturnType<typeof createProg>;
}

interface OverrideHarness {
	readonly clack: NonNullable<ProgDeps["clack"]>;
	readonly exitPromise: Promise<number>;
	readonly prog: ReturnType<typeof createProg>;
}

function emptyState(environment: string): BedrockState {
	return { environment, resources: [], version: 1 };
}

function buildHarness(
	deployResults: ReadonlyArray<Result<BedrockState, DeployError>>,
): DeployHarness {
	let resolveExit!: (code: number) => void;
	const exitPromise = new Promise<number>((resolve) => {
		resolveExit = resolve;
	});
	const exit = vi.fn<ExitFunc>((code) => {
		resolveExit(code);
	});

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

	const clack = fakeClackPort();
	const prog = createProg({ clack, deploy, exit, loadConfig });
	return { clack, deploy, exitPromise, loadConfig, prog };
}

function buildOverrideHarness(discoveredPath: string): OverrideHarness {
	let resolveExit!: (code: number) => void;
	const exitPromise = new Promise<number>((resolve) => {
		resolveExit = resolve;
	});
	const exit = vi.fn<ExitFunc>((code) => {
		resolveExit(code);
	});
	const loadConfig = vi.fn<LoadConfigFunc>(async () => ({ data: fakeConfig, success: true }));
	const discoverOverride = vi.fn<DiscoverOverrideFunc>(() => discoveredPath);

	const clack = fakeClackPort();
	const prog = createProg({ clack, discoverOverride, exit, loadConfig });
	return { clack, exitPromise, prog };
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

describe("cli deploy dispatch through a dot-bedrock override", () => {
	it("should exit 0 when a discovered override script exits zero", async () => {
		expect.assertions(2);

		const harness = buildOverrideHarness(EXIT_ZERO);

		dispatch(harness.prog, ["deploy", "--env", "production"]);
		const code = await harness.exitPromise;

		expect(code).toBe(0);
		expect(harness.clack.outro).toHaveBeenCalledExactlyOnceWith("deploy succeeded");
	});

	it("should exit 1 and cancel when a discovered override script exits non-zero", async () => {
		expect.assertions(3);

		const harness = buildOverrideHarness(EXIT_NON_ZERO);

		dispatch(harness.prog, ["deploy", "--env", "production"]);
		const code = await harness.exitPromise;

		expect(code).toBe(1);
		expect(harness.clack.logError).toHaveBeenCalledExactlyOnceWith(
			"production: override exited with code 3",
		);
		expect(harness.clack.cancel).toHaveBeenCalledExactlyOnceWith("deploy failed");
	});

	it("should spawn the override for every --env even when an earlier env exits non-zero", async () => {
		expect.assertions(3);

		const harness = buildOverrideHarness(EXIT_NON_ZERO);

		dispatch(harness.prog, ["deploy", "--env", "production", "--env", "staging"]);
		const code = await harness.exitPromise;

		expect(code).toBe(1);

		const messages = vi.mocked(harness.clack.logError).mock.calls.map(([line]) => line);

		expect(messages).toStrictEqual([
			"production: override exited with code 3",
			"staging: override exited with code 3",
		]);
		expect(harness.clack.cancel).toHaveBeenCalledExactlyOnceWith("deploy failed");
	});
});
