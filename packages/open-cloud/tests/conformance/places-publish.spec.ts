import { assert, describe, it } from "vitest";

import { expectValid, getAjv, loadFixture } from "./_helpers.ts";

// The captured server response is application/json. The vendored publish 200
// only declares a text/plain string containing JSON; its PlaceVersion component
// describes version history, not this response. Validate the documented text
// representation here. There is no matching schema for the decoded payload:
// parsers.fixtures.spec.ts pins its numeric versionNumber instead.

describe("legacy place publish capture", () => {
	it("should validate the JSON-encoded capture against the documented text/plain schema", ({
		expect,
	}) => {
		expect.assertions(1);

		const validator = getAjv("response").getSchema(
			"roblox-openapi#/paths/~1universes~1v1~1{universeId}~1places~1{placeId}~1versions/post/responses/200/content/text~1plain/schema",
		);
		assert(validator);

		expectValid(expect, {
			fixture: JSON.stringify(loadFixture("places", "publish-response.json")),
			validator,
		});
	});
});
