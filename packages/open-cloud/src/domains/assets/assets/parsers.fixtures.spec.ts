import { assert, describe, it } from "vitest";

import { loadFixture } from "#tests/conformance/_helpers";
import {
	parseAssetIconResponse,
	parseAssetOperationResponse,
	parseAssetResponse,
} from "./parsers.ts";

// Captured 2026-11-27 against apis.roblox.com with
// `scripts/probe-place-icon.ts` on the start place of a user-owned test
// universe; IDs and display names scrubbed, shapes verbatim. See
// `tests/fixtures/assets/place-icon-capture.md`. Quirks these pin:
//
//  - A plain GET never returns `icon`, even when the place has one.
//  - An empty `description` is absent, not `""` or `null`.
//  - Only `readMask=icon` returns `icon`, as `"assets/<id>"`.
//  - A `readMask` response holds only the masked fields that have a value:
//    no `path` or `assetId`, and a missing icon is absent, not `null`.
//  - Before `done: true` the operation has no `response`, and an asset
//    operation never carries `metadata`.
//  - The icon PATCH operation's `response` is the place without `icon`.
//
// `create-image-operation-failed-response.json` is hand-built from the
// vendored `AssetsUploadApi.Operation` schema; no failure was captured.

describe(parseAssetResponse, () => {
	it("should parse a captured plain GET of a place", ({ expect }) => {
		expect.assertions(1);

		const body = loadFixture("assets", "get-place-response.json");

		const result = parseAssetResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data).toStrictEqual({ assetId: "456", moderationState: "Approved" });
	});
});

describe(parseAssetIconResponse, () => {
	it.for([
		{ expected: "789", fixture: "get-place-icon-response.json" },
		{ expected: undefined, fixture: "get-place-icon-empty-response.json" },
		{ expected: undefined, fixture: "get-place-wide-mask-response.json" },
	])(
		"should read the icon of captured $fixture as $expected",
		({ expected, fixture }, { expect }) => {
			expect.assertions(1);

			const body = loadFixture("assets", fixture);

			const result = parseAssetIconResponse({ body, headers: {}, status: 200 });

			expect(result).toStrictEqual({ data: expected, success: true });
		},
	);
});

describe(parseAssetOperationResponse, () => {
	it("should parse a captured pending create operation", ({ expect }) => {
		expect.assertions(1);

		const body = loadFixture("assets", "create-image-response.json");

		const result = parseAssetOperationResponse({ body, headers: {}, status: 200 });

		expect(result).toStrictEqual({
			data: {
				done: false,
				error: undefined,
				operationId: "00000000-0000-0000-0000-000000000001",
				response: undefined,
			},
			success: true,
		});
	});

	it("should parse a captured done create operation with the new image as its response", ({
		expect,
	}) => {
		expect.assertions(2);

		const body = loadFixture("assets", "create-image-operation-done-response.json");

		const result = parseAssetOperationResponse({ body, headers: {}, status: 200 });
		assert(result.success);

		expect(result.data.done).toBeTrue();
		expect(
			parseAssetResponse({ body: result.data.response, headers: {}, status: 200 }),
		).toStrictEqual({
			data: { assetId: "789", moderationState: "Approved" },
			success: true,
		});
	});

	it("should parse a failed operation's error", ({ expect }) => {
		expect.assertions(1);

		const body = loadFixture("assets", "create-image-operation-failed-response.json");

		const result = parseAssetOperationResponse({ body, headers: {}, status: 200 });
		assert(result.success);

		expect(result.data.error).toStrictEqual({
			code: "INVALID_ARGUMENT",
			message: "The image could not be processed.",
		});
	});
});

describe("icon update operation fixtures", () => {
	it("should parse the captured done update operation as done with no error", ({ expect }) => {
		expect.assertions(2);

		const body = loadFixture("assets", "update-icon-operation-done-response.json");

		const result = parseAssetOperationResponse({ body, headers: {}, status: 200 });
		assert(result.success);

		expect([result.data.done, result.data.error]).toStrictEqual([true, undefined]);
		expect(result.data.response).not.toHaveProperty("icon");
	});
});
