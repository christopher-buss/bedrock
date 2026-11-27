import { assert, describe, it } from "vitest";

import { loadFixture } from "#tests/conformance/_helpers";
import { parseAssetIconResponse, parseAssetResponse } from "./parsers.ts";

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
