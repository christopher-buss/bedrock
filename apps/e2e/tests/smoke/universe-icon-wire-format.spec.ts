import { ApiError } from "@bedrock/ocale";
import { UniversesClient } from "@bedrock/ocale/universes";

import process from "node:process";
import { assert, describe, expect, it } from "vitest";

const API_KEY = process.env["BEDROCK_API_KEY"];
const UNIVERSE_ID = process.env["ROBLOX_TEST_UNIVERSE_ID"];

const HAS_SECRETS = API_KEY !== undefined && UNIVERSE_ID !== undefined;

// Minimal valid 1x1 transparent PNG. A real image format keeps the
// request stable against any change in Roblox's validation order
// between language-code and image-bytes checks.
const ICON_BYTES = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
	0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
	0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
	0x42, 0x60, 0x82,
]);

// Uploading the source-language icon is rejected by Roblox; we use that
// rejection only as a deterministic way to elicit an error response, then
// assert on bedrock's structured surfacing of it. The specific error code
// and message text are kept loose so a Roblox-side reword does not block
// every PR.
describe("universe icon error surfacing on real Roblox", () => {
	it.skipIf(!HAS_SECRETS)(
		"should surface a structured ApiError when Roblox rejects an upload",
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

			const { code, message, statusCode } = result.err;

			expect(statusCode).toBe(400);

			assert(code !== undefined);

			expect(code.length).toBeGreaterThan(0);
			expect(message.length).toBeGreaterThan(0);
		},
	);
});
