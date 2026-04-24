import { type BedrockState, createGistStateAdapter } from "@bedrock/core";

import process from "node:process";
import { assert, describe, expect, it } from "vitest";

const TOKEN = process.env["GITHUB_TOKEN"];
const GIST_ID = process.env["BEDROCK_TEST_GIST_ID"];

const HAS_SECRETS = TOKEN !== undefined && GIST_ID !== undefined;

describe("gist state adapter against real github", () => {
	it.skipIf(!HAS_SECRETS)(
		"should round-trip a state file through a real gist and clean up after itself",
		async () => {
			expect.assertions(4);

			assert(TOKEN !== undefined, "GITHUB_TOKEN must be set");
			assert(GIST_ID !== undefined, "BEDROCK_TEST_GIST_ID must be set");

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

			const deleteResponse = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
				body: JSON.stringify({ files: { [`state.${environment}.json`]: null } }),
				headers: {
					"Accept": "application/vnd.github+json",
					"Authorization": `Bearer ${TOKEN}`,
					"Content-Type": "application/json",
					"User-Agent": "bedrock",
					"X-GitHub-Api-Version": "2026-03-10",
				},
				method: "PATCH",
			});

			expect(deleteResponse.status).toBeGreaterThanOrEqual(200);
			expect(deleteResponse.status).toBeLessThan(300);
		},
		30_000,
	);
});
