import { assert, describe, it } from "vitest";

import { expectValid, getAjv, loadFixture } from "./_helpers.ts";

// The 2026-10-26 capture is application/json. Local drift patch 11 adds its
// decoded response schema while preserving the upstream text/plain alternative.
const PUBLISH_JSON_SCHEMA =
	"roblox-openapi#/paths/~1universes~1v1~1{universeId}~1places~1{placeId}~1versions/post/responses/200/content/application~1json/schema";

describe("legacy place publish capture", () => {
	it("should validate the decoded capture against the publish application/json schema", ({
		expect,
	}) => {
		expect.assertions(1);

		const validator = getAjv("response").getSchema(PUBLISH_JSON_SCHEMA);
		assert(validator);

		expectValid(expect, {
			fixture: loadFixture("places", "publish-response.json"),
			validator,
		});
	});

	it.for([
		{ name: "a missing versionNumber", body: {} },
		{ name: "a string versionNumber", body: { versionNumber: "6" } },
		{ name: "a null versionNumber", body: JSON.parse('{"versionNumber":null}') },
		{ name: "a boolean versionNumber", body: { versionNumber: true } },
		{ name: "an object versionNumber", body: { versionNumber: {} } },
		{ name: "an array versionNumber", body: { versionNumber: [] } },
		{ name: "an array body", body: [{ versionNumber: 6 }] },
		{ name: "a plain text body", body: "not JSON" },
	])("should reject $name against the publish JSON schema", ({ body }, { expect }) => {
		expect.assertions(1);

		const validator = getAjv("response").getSchema(PUBLISH_JSON_SCHEMA);
		assert(validator);

		expect(validator(body)).toBe(false);
	});
});
