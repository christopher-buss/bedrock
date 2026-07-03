import type { Result } from "@bedrock-rbx/ocale";

import { fakeClackPort } from "#tests/helpers/clack";
import process from "node:process";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import type { ProgDeps } from "../index.ts";
import type { Spawner, SpawnInvocation, SpawnLaunchError } from "../spawner.ts";
import { buildCommand } from "./build.ts";

type ExitFunc = NonNullable<ProgDeps["exit"]>;
type DiscoverOverrideFunc = NonNullable<ProgDeps["discoverOverride"]>;

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

function makeDeps(overrides: Partial<ProgDeps> = {}): ProgDeps {
	return {
		clack: fakeClackPort(),
		exit: vi.fn<ExitFunc>(),
		...overrides,
	};
}

describe(buildCommand, () => {
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

		const deps = makeDeps();

		await buildCommand(deps)(rawOptions);

		expect(deps.clack?.intro).toHaveBeenCalledExactlyOnceWith("bedrock build");
		expect(deps.clack?.logError).toHaveBeenCalledExactlyOnceWith(expect.any(String));
		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("build failed");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should query discoverOverride with the configured projectRoot and the 'build' command name", async () => {
		expect.assertions(1);

		const discoverOverride = discoverReturning(undefined);
		const deps = makeDeps({ discoverOverride, projectRoot: "/abs/project" });

		await buildCommand(deps)({ env: "production" });

		expect(discoverOverride).toHaveBeenCalledExactlyOnceWith("/abs/project", "build");
	});

	it("should render an error and exit 1 when discoverOverride throws", async () => {
		expect.assertions(3);

		const discoverOverride = vi.fn<DiscoverOverrideFunc>(() => {
			throw new Error("EACCES: permission denied, stat '/project/.bedrock/build.ts'");
		});
		const deps = makeDeps({ discoverOverride, projectRoot: "/project" });

		await buildCommand(deps)({ env: "production" });

		expect(deps.clack?.logError).toHaveBeenCalledExactlyOnceWith(
			"override discovery failed: EACCES: permission denied, stat '/project/.bedrock/build.ts'",
		);
		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("build failed");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should dispatch the spawner and exit 0 when an override is discovered", async () => {
		expect.assertions(3);

		const { invocations, spawner } = recordingSpawner({ data: 0, success: true });
		const discoverOverride = discoverReturning("/abs/.bedrock/build.ts");
		const deps = makeDeps({ discoverOverride, projectRoot: "/abs", spawner });

		await buildCommand(deps)({ env: "production" });

		expect(invocations).toHaveLength(1);
		expect(deps.clack?.outro).toHaveBeenCalledExactlyOnceWith("build succeeded");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should forward the discovered override path and parsed flags into the spawned invocation", async () => {
		expect.assertions(4);

		const { invocations, spawner } = recordingSpawner({ data: 0, success: true });
		const discoverOverride = discoverReturning("/abs/.bedrock/build.ts");
		const deps = makeDeps({ discoverOverride, projectRoot: "/abs", spawner });

		await buildCommand(deps)({
			"api-key": "rbx-key",
			"config": "./bedrock.staging.config.ts",
			"env": "production",
			"github-token": "ghp-token",
		});

		const args = invocations[0]?.args ?? [];

		expect(args).toStrictEqual([
			"/abs/.bedrock/build.ts",
			"--env",
			"production",
			"--config",
			"./bedrock.staging.config.ts",
		]);
		expect(invocations[0]?.envOverrides).toMatchObject({
			BEDROCK_API_KEY: "rbx-key",
			BEDROCK_CLI: "1",
			BEDROCK_GITHUB_TOKEN: "ghp-token",
		});
		expect(args).not.toContain("rbx-key");
		expect(args).not.toContain("ghp-token");
	});

	it("should dispatch the spawner once per --env when multiple environments are requested", async () => {
		expect.assertions(3);

		const { invocations, spawner } = recordingSpawner({ data: 0, success: true });
		const discoverOverride = discoverReturning("/abs/.bedrock/build.ts");
		const deps = makeDeps({ discoverOverride, projectRoot: "/abs", spawner });

		await buildCommand(deps)({ env: ["production", "staging"] });

		expect(invocations).toHaveLength(2);

		const environmentValues = invocations.map((invocation) => {
			const { args } = invocation;
			return args[args.indexOf("--env") + 1];
		});

		expect(environmentValues).toStrictEqual(["production", "staging"]);
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should cancel and exit 1 when an override spawn returns a non-zero exit code", async () => {
		expect.assertions(3);

		const { spawner } = recordingSpawner({ data: 3, success: true });
		const discoverOverride = discoverReturning("/abs/.bedrock/build.ts");
		const deps = makeDeps({ discoverOverride, spawner });

		await buildCommand(deps)({ env: "production" });

		expect(deps.clack?.logError).toHaveBeenCalledExactlyOnceWith(
			"production: override exited with code 3",
		);
		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("build failed");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
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
		const discoverOverride = discoverReturning("/abs/.bedrock/build.ts");
		const deps = makeDeps({ discoverOverride, spawner });

		await buildCommand(deps)({ env: "production" });

		expect(deps.clack?.logError).toHaveBeenCalledExactlyOnceWith(
			"production: failed to launch override - spawn bun ENOENT",
		);
		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("build failed");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should run every env via spawn even when an earlier env's spawn exits non-zero", async () => {
		expect.assertions(2);

		const invocations: Array<SpawnInvocation> = [];
		let callIndex = 0;
		const results: ReadonlyArray<Result<number, SpawnLaunchError>> = [
			{ data: 3, success: true },
			{ data: 0, success: true },
		];
		const spawner: Spawner = {
			async spawn(invocation) {
				invocations.push(invocation);
				const next = results[callIndex];
				callIndex += 1;
				if (next === undefined) {
					throw new Error("spawner invoked beyond scripted results");
				}

				return next;
			},
		};
		const discoverOverride = discoverReturning("/abs/.bedrock/build.ts");
		const deps = makeDeps({ discoverOverride, spawner });

		await buildCommand(deps)({ env: ["production", "staging"] });

		expect(invocations).toHaveLength(2);
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should report nothing to build and exit 0 when no override is discovered", async () => {
		expect.assertions(2);

		const { invocations, spawner } = recordingSpawner({ data: 0, success: true });
		const discoverOverride = discoverReturning(undefined);
		const deps = makeDeps({ discoverOverride, spawner });

		await buildCommand(deps)({ env: "production" });

		expect(deps.clack?.outro).toHaveBeenCalledExactlyOnceWith("nothing to build");
		expect(invocations).toHaveLength(0);
	});

	it("should default to process.exit when no exit slot is provided", async () => {
		expect.assertions(1);

		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation((() => {}) as typeof process.exit);

		try {
			await buildCommand({ clack: fakeClackPort() })({});

			expect(exitSpy).toHaveBeenCalledExactlyOnceWith(1);
		} finally {
			exitSpy.mockRestore();
		}
	});
});
