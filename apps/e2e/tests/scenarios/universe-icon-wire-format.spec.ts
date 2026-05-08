import { ApiError } from "@bedrock/ocale";
import { UniversesClient } from "@bedrock/ocale/universes";

import process from "node:process";
import { assert, describe, expect, it } from "vitest";

const API_KEY = process.env["BEDROCK_API_KEY"];
const UNIVERSE_ID = process.env["ROBLOX_TEST_UNIVERSE_ID"];

const HAS_SECRETS = API_KEY !== undefined && UNIVERSE_ID !== undefined;

const ICON_BYTES = new Uint8Array([1, 2, 3]);

describe("universe icon wire-format on real Roblox", () => {
	it.skipIf(!HAS_SECRETS)(
		"should surface code 26 with a structured ApiError when uploading the source-language icon",
		async () => {
			expect.assertions(4);

			assert(API_KEY !== undefined, "BEDROCK_API_KEY must be set");
			assert(UNIVERSE_ID !== undefined, "ROBLOX_TEST_UNIVERSE_ID must be set");

			const client = new UniversesClient({ apiKey: API_KEY });
			const result = await client.icon.upload({
				image: ICON_BYTES,
				languageCode: "en",
				universeId: UNIVERSE_ID,
			});

			assert(!result.success, "expected source-language upload to fail");

			expect(result.err).toBeInstanceOf(ApiError);

			assert(result.err instanceof ApiError);

			expect(result.err.statusCode).toBe(400);
			expect(result.err.code).toBe("26");
			expect(result.err.message).toMatch(/source language/i);
		},
	);
});
