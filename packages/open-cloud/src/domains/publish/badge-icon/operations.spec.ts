import { describe, expect, it } from "vitest";

import { UPLOAD_ICON_OPERATION_LIMIT, UPLOAD_ICON_REQUIRED_SCOPES } from "./operations.ts";

describe("badge icon upload operation limits", () => {
	it("should cap the upload endpoint at 100 requests per minute on its own bucket", () => {
		expect.assertions(1);

		expect(UPLOAD_ICON_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 100 / 60,
			operationKey: "badges.upload-icon",
		});
	});
});

describe("badge icon upload required scopes", () => {
	it("should require legacy-badge:manage to upload an icon", () => {
		expect.assertions(1);

		expect(UPLOAD_ICON_REQUIRED_SCOPES).toStrictEqual(["legacy-badge:manage"]);
	});
});
