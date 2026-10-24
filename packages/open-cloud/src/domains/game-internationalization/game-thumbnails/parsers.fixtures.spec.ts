import { assert, describe, it } from "vitest";

import { loadFixture } from "#tests/conformance/_helpers";
import { parseThumbnailUploadResponse } from "./parsers.ts";

// Captured against the live Open Cloud API at apis.roblox.com in
// 2026-10; mediaAssetId scrubbed to a placeholder, otherwise the shape
// is verbatim. The id arrives as a JSON string, not a number.

describe(parseThumbnailUploadResponse, () => {
	it("should parse a captured UPLOAD 200 carrying a string media asset id", ({ expect }) => {
		expect.assertions(1);

		const body = loadFixture("universes", "upload-thumbnail-response.json");

		const result = parseThumbnailUploadResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data).toStrictEqual({ mediaAssetId: "123456789" });
	});
});
