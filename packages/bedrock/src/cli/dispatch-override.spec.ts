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
});
