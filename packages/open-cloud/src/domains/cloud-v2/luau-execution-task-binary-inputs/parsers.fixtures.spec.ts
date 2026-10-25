import { assert, describe, it } from "vitest";

import { loadFixture } from "#tests/conformance/_helpers";
import { parseBinaryInputResponse } from "./parsers.ts";

// Captured 2026-10-25 from POST
// /cloud/v2/universes/{universeId}/luau-execution-session-task-binary-inputs
// at apis.roblox.com with { size: 1 }. Universe/input ids, upload host/path
// and signing credential/signature were replaced with stable fakes. Field
// presence, nesting, types and query encoding are otherwise verbatim.
// The server also returns size, which the public parser does not expose.

describe(parseBinaryInputResponse, () => {
	it("should parse a captured binary-input upload slot into its resource path and upload URI", ({
		expect,
	}) => {
		expect.assertions(1);

		const body = loadFixture("luau-execution-task-binary-inputs", "create-response.json");

		const result = parseBinaryInputResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data).toStrictEqual({
			path: "universes/123/luau-execution-session-task-binary-inputs/test-input",
			uploadUri:
				"https://uploads.example.com/test-upload-1/test-upload-2?X-Amz-Expires=900&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=redacted%2Fredacted%2Fredacted%2Fredacted%2Fredacted&X-Amz-Date=20261025T020741Z&X-Amz-SignedHeaders=content-length%3Bhost&X-Amz-Signature=redacted",
		});
	});
});
