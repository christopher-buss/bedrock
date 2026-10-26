import { assert, describe, it } from "vitest";

import { loadFixture } from "#tests/conformance/_helpers";
import { parsePublishResponse } from "./parsers.ts";

// Captured 2026-10-26 from POST
// /universes/v1/{universeId}/places/{placeId}/versions?versionType=Published
// at apis.roblox.com, publishing the repository smoke place to the configured
// Bedrock-only test universe's existing root place. The response contains no
// identifying values; versionNumber and the JSON shape are unchanged.
// The server returned application/json; the documented text/plain alternative
// is also exercised by passing the capture as a JSON string.

describe(parsePublishResponse, () => {
	it.for([
		{ contentType: "application/json; charset=utf-8", encode: (body: JSONValue) => body },
		{ contentType: "text/plain", encode: (body: JSONValue) => JSON.stringify(body) },
	])(
		"should parse the captured publish 200 as $contentType into its version number",
		({ contentType, encode }, { expect }) => {
			expect.assertions(2);

			const captured = loadFixture("places", "publish-response.json");

			expect(captured).toStrictEqual({ versionNumber: 6 });

			const result = parsePublishResponse({
				body: encode(captured),
				headers: { "content-type": contentType },
				status: 200,
			});

			assert(result.success);

			expect(result.data).toStrictEqual({ versionNumber: 6 });
		},
	);
});
