import { asSha256Hex, type BedrockState, createGistStateAdapter } from "@bedrock-rbx/core";

import process from "node:process";
import { assert, describe, expect, it, onTestFinished } from "vitest";

import { assertOk } from "../helpers/assert-ok.ts";
import { pruneStateGistAsync } from "../helpers/prune-state-gist.ts";
import { readStateUntilAsync } from "../helpers/read-state-until.ts";

const TOKEN = process.env["GITHUB_TOKEN"];
const GIST_ID = process.env["BEDROCK_TEST_GIST_ID"];

const HAS_SECRETS = TOKEN !== undefined && GIST_ID !== undefined;

// Every environment this file writes starts `smoke-`, so one prune covers
// the whole file. How many past runs stay in the gist to be read by hand.
const PRUNE_PREFIX = "state.smoke-";
const KEEP = 4;

// A gist serves a write from a replica that can still be behind it, so a read
// taken straight after one is retried until the write shows up.
const READ_ATTEMPTS = 7;
const READ_BASE_DELAY_MS = 500;

// The backoff doubles each retry, so the poll sleeps for
// `base * (2 ** (attempts - 1) - 1)` before it spends its budget. A test here
// polls at most twice, and each poll follows a write whose own visibility
// check has to clear first, so the ceiling covers two full polls and the
// requests around them.
const READ_BUDGET_MS = READ_BASE_DELAY_MS * (2 ** (READ_ATTEMPTS - 1) - 1);
const TEST_TIMEOUT_MS = READ_BUDGET_MS * 2 + 30_000;

// A digest the second write stamps, so its bytes differ from what the first
// write left and a read can tell the two apart.
const OVERWRITE_DIGEST = "a3f1c2d4e5b60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

/**
 * Prune the gist back to the newest {@link KEEP} smoke files once the calling
 * test finishes, leaving the most recent runs to be read by hand.
 *
 * @param gistId - Gist the smoke **State** files live in.
 * @param token - Token the gist is written with.
 */
function pruneWhenFinished(gistId: string, token: string): void {
	onTestFinished(async () => {
		await pruneStateGistAsync({ filenamePrefix: PRUNE_PREFIX, gistId, keep: KEEP, token });
	});
}

describe("gist state adapter against real github", () => {
	it.skipIf(!HAS_SECRETS)(
		"should round-trip a state file through a real gist",
		async () => {
			expect.assertions(2);

			assert(TOKEN !== undefined, "GITHUB_TOKEN must be set");
			assert(GIST_ID !== undefined, "BEDROCK_TEST_GIST_ID must be set");

			pruneWhenFinished(GIST_ID, TOKEN);

			const environment = `smoke-${Date.now()}`;
			const port = createGistStateAdapter({ gistId: GIST_ID, token: TOKEN });

			const state: BedrockState = {
				environment,
				resources: [],
				version: 1,
			};

			const firstRead = await port.read(environment);

			// No `version` on the record: a gist has no version primitive, and
			// that absence is what leaves the write below unconditional.
			expect(firstRead).toStrictEqual({ data: {}, success: true });

			const writeResult = await port.write(state);
			assertOk(writeResult, "write");

			const secondRead = await readStateUntilAsync({
				attempts: READ_ATTEMPTS,
				baseDelayMs: READ_BASE_DELAY_MS,
				environment,
				predicate: () => true,
				statePort: port,
			});

			assert(secondRead.success);

			expect(secondRead.data).toStrictEqual({ state });
		},
		TEST_TIMEOUT_MS,
	);

	it.skipIf(!HAS_SECRETS)(
		"should land a write the caller fenced on a record that has since appeared",
		async () => {
			expect.assertions(2);

			assert(TOKEN !== undefined, "GITHUB_TOKEN must be set");
			assert(GIST_ID !== undefined, "BEDROCK_TEST_GIST_ID must be set");

			pruneWhenFinished(GIST_ID, TOKEN);

			const environment = `smoke-unfenced-${Date.now()}`;
			const port = createGistStateAdapter({ gistId: GIST_ID, token: TOKEN });
			const state: BedrockState = { environment, resources: [], version: 1 };

			const first = await port.write(state);
			assertOk(first, "first write");

			const stale = await readStateUntilAsync({
				attempts: READ_ATTEMPTS,
				baseDelayMs: READ_BASE_DELAY_MS,
				environment,
				predicate: () => true,
				statePort: port,
			});
			assertOk(stale, "read of the record the first write left");

			expect(stale.data.version).toBeUndefined();

			// A record exists by now, so a backend that can fence refuses a
			// write claiming there was none. A gist cannot fence: it overwrites
			// whatever is there, which is the contract the absent version above
			// tells the caller to expect.
			const overwrite = await port.write(
				{ ...state, codegenHash: asSha256Hex(OVERWRITE_DIGEST) },
				{ kind: "absent" },
			);
			assertOk(overwrite, "a write fenced on a record that has since appeared");

			const after = await readStateUntilAsync({
				attempts: READ_ATTEMPTS,
				baseDelayMs: READ_BASE_DELAY_MS,
				environment,
				predicate: (found) => found.codegenHash !== undefined,
				statePort: port,
			});

			assert(after.success);
			assert(after.data.state !== undefined);

			expect(after.data.state.codegenHash).toBe(OVERWRITE_DIGEST);
		},
		TEST_TIMEOUT_MS,
	);
});
