import { describe, it } from "vitest";

import { expectValid, getValidator, loadFixture } from "./_helpers.ts";

describe("assets fixtures", () => {
	it.for([
		{ fixture: "get-place-response.json", schema: "AssetsUploadApi.Asset" },
		{ fixture: "get-place-icon-response.json", schema: "AssetsUploadApi.Asset" },
		{ fixture: "get-place-icon-empty-response.json", schema: "AssetsUploadApi.Asset" },
		{ fixture: "get-place-wide-mask-response.json", schema: "AssetsUploadApi.Asset" },
	])("should validate $fixture against $schema", ({ fixture, schema }, { expect }) => {
		expect.assertions(1);

		expectValid(expect, {
			fixture: loadFixture("assets", fixture),
			validator: getValidator(schema),
		});
	});
});
