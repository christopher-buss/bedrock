import type { Result } from "@bedrock-rbx/ocale";

import { describe, expect, it } from "vitest";

import { dispatchOverride } from "./dispatch-override.ts";
import type { Spawner, SpawnInvocation, SpawnLaunchError } from "./spawner.ts";

interface Recorder {
	readonly invocations: ReadonlyArray<SpawnInvocation>;
	readonly spawner: Spawner;
}

function recordingSpawner(result: Result<number, SpawnLaunchError>): Recorder {
	const invocations: Array<SpawnInvocation> = [];
	const spawner: Spawner = {
		async spawn(invocation) {
			invocations.push(invocation);
			return result;
		},
	};
	return { invocations, spawner };
}

function okSpawner(exitCode: number): Recorder {
	return recordingSpawner({ data: exitCode, success: true });
}

describe(dispatchOverride, () => {
	it("should invoke 'bun' as the spawned command", async () => {
		expect.assertions(1);

		const { invocations, spawner } = okSpawner(0);

		await dispatchOverride(
			{ environment: "production", overridePath: "/abs/.bedrock/deploy.ts" },
			spawner,
		);

		expect(invocations[0]?.command).toBe("bun");
	});

	it("should pass the override path as the first argv entry", async () => {
		expect.assertions(1);

		const { invocations, spawner } = okSpawner(0);

		await dispatchOverride(
			{ environment: "production", overridePath: "/abs/.bedrock/deploy.ts" },
			spawner,
		);

		expect(invocations[0]?.args[0]).toBe("/abs/.bedrock/deploy.ts");
	});

	it("should include exactly one '--env' flag in argv", async () => {
		expect.assertions(1);

		const { invocations, spawner } = okSpawner(0);

		await dispatchOverride(
			{ environment: "production", overridePath: "/abs/.bedrock/deploy.ts" },
			spawner,
		);

		const occurrences =
			invocations[0]?.args.filter((argument) => argument === "--env").length ?? 0;

		expect(occurrences).toBe(1);
	});

	it("should pass the environment name immediately after '--env'", async () => {
		expect.assertions(1);

		const { invocations, spawner } = okSpawner(0);

		await dispatchOverride(
			{ environment: "production", overridePath: "/abs/.bedrock/deploy.ts" },
			spawner,
		);

		const args = invocations[0]?.args ?? [];
		const flagIndex = args.indexOf("--env");

		expect(args[flagIndex + 1]).toBe("production");
	});

	it("should forward '--config <path>' in argv when configFile is supplied", async () => {
		expect.assertions(2);

		const { invocations, spawner } = okSpawner(0);

		await dispatchOverride(
			{
				configFile: "./bedrock.staging.config.ts",
				environment: "production",
				overridePath: "/abs/.bedrock/deploy.ts",
			},
			spawner,
		);

		const args = invocations[0]?.args ?? [];
		const flagIndex = args.indexOf("--config");

		expect(flagIndex).toBeGreaterThanOrEqual(0);
		expect(args[flagIndex + 1]).toBe("./bedrock.staging.config.ts");
	});

	it("should omit '--config' from argv when configFile is undefined", async () => {
		expect.assertions(1);

		const { invocations, spawner } = okSpawner(0);

		await dispatchOverride(
			{ environment: "production", overridePath: "/abs/.bedrock/deploy.ts" },
			spawner,
		);

		expect(invocations[0]?.args).not.toContain("--config");
	});

	it("should set BEDROCK_API_KEY in envOverrides when apiKey is supplied", async () => {
		expect.assertions(1);

		const { invocations, spawner } = okSpawner(0);

		await dispatchOverride(
			{
				apiKey: "rbx-123",
				environment: "production",
				overridePath: "/abs/.bedrock/deploy.ts",
			},
			spawner,
		);

		expect(invocations[0]?.envOverrides).toMatchObject({ BEDROCK_API_KEY: "rbx-123" });
	});

	it("should set GITHUB_TOKEN in envOverrides when githubToken is supplied", async () => {
		expect.assertions(1);

		const { invocations, spawner } = okSpawner(0);

		await dispatchOverride(
			{
				environment: "production",
				githubToken: "ghp_456",
				overridePath: "/abs/.bedrock/deploy.ts",
			},
			spawner,
		);

		expect(invocations[0]?.envOverrides).toMatchObject({ GITHUB_TOKEN: "ghp_456" });
	});

	it("should keep credential values out of argv", async () => {
		expect.assertions(4);

		const { invocations, spawner } = okSpawner(0);

		await dispatchOverride(
			{
				apiKey: "rbx-123",
				environment: "production",
				githubToken: "ghp_456",
				overridePath: "/abs/.bedrock/deploy.ts",
			},
			spawner,
		);

		const args = invocations[0]?.args ?? [];

		expect(args).not.toContain("--api-key");
		expect(args).not.toContain("rbx-123");
		expect(args).not.toContain("--github-token");
		expect(args).not.toContain("ghp_456");
	});
});
