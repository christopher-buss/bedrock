import { type BedrockState, createGistStateAdapter } from "@bedrock-rbx/core";

import process from "node:process";
import { assert, describe, expect, it, onTestFinished } from "vitest";

import { pruneStateGist } from "../helpers/prune-state-gist.ts";

const TOKEN = process.env["GITHUB_TOKEN"];
const GIST_ID = process.env["BEDROCK_TEST_GIST_ID"];

const HAS_SECRETS = TOKEN !== undefined && GIST_ID !== undefined;

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

			const secondRead = await port.read(environment);
			assert(secondRead.success);

			expect(secondRead.data).toStrictEqual(state);
		},
		30_000,
	);
});
