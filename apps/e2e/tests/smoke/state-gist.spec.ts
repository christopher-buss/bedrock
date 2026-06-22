import { type BedrockState, createGistStateAdapter, type StatePort } from "@bedrock-rbx/core";

import process from "node:process";
import { assert, describe, expect, it, onTestFinished } from "vitest";

import { pruneStateGist } from "../helpers/prune-state-gist.ts";

const TOKEN = process.env["GITHUB_TOKEN"];
const GIST_ID = process.env["BEDROCK_TEST_GIST_ID"];

const HAS_SECRETS = TOKEN !== undefined && GIST_ID !== undefined;

const READ_VISIBILITY_BUDGET_MS = 40_000;
const READ_POLL_INTERVAL_MS = 1_000;

async function sleep(ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});
}

/**
 * Read state, retrying until the write is visible or the deadline passes. The
 * gist write-visibility poll is best-effort, so a fresh file can still lag on a
 * slow GitHub replica once that budget is spent. Polling lets the round-trip
 * tolerate eventual consistency instead of racing replica propagation.
 *
 * @param inputs - State port, environment name, and the absolute poll deadline.
 * @returns The first read carrying data, or the last read once the deadline passes.
 */
async function readUntilVisible(inputs: {
	readonly deadline: number;
	readonly environment: string;
	readonly port: StatePort;
}): Promise<Awaited<ReturnType<StatePort["read"]>>> {
	const { deadline, environment, port } = inputs;
	const read = await port.read(environment);
	if (!read.success || read.data !== undefined || Date.now() >= deadline) {
		return read;
	}

	await sleep(READ_POLL_INTERVAL_MS);
	return readUntilVisible(inputs);
}

describe("gist state adapter against real github", () => {
	it.skipIf(!HAS_SECRETS)(
		"should round-trip a state file through a real gist and clean up after itself",
		async () => {
			expect.assertions(2);

			assert(TOKEN !== undefined, "GITHUB_TOKEN must be set");
			assert(GIST_ID !== undefined, "BEDROCK_TEST_GIST_ID must be set");

			onTestFinished(async () => {
				await pruneStateGist({
					filenamePrefix: "state.smoke-",
					gistId: GIST_ID,
					keep: 3,
					token: TOKEN,
				});
			});

			const environment = `smoke-${Date.now()}`;
			const port = createGistStateAdapter({ gistId: GIST_ID, token: TOKEN });

			const state: BedrockState = {
				environment,
				resources: [],
				version: 1,
			};

			const firstRead = await port.read(environment);

			expect(firstRead).toStrictEqual({ data: undefined, success: true });

			const writeResult = await port.write(state);
			assert(
				writeResult.success,
				`write failed: ${JSON.stringify(writeResult.success ? undefined : writeResult.err)}`,
			);

			const secondRead = await readUntilVisible({
				deadline: Date.now() + READ_VISIBILITY_BUDGET_MS,
				environment,
				port,
			});

			assert(secondRead.success);

			expect(secondRead.data).toStrictEqual(state);
		},
		60_000,
	);
});
