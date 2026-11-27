import { assert, describe, it } from "vitest";

import { loadFixture } from "#tests/conformance/_helpers";
import { parseAssetResponse } from "./parsers.ts";

// Captured 2026-11-27 against apis.roblox.com with
// `scripts/probe-place-icon.ts` on the start place of a user-owned test
// universe; IDs and display names scrubbed, shapes verbatim. See
// `tests/fixtures/assets/place-icon-capture.md`. Quirks these pin:
//
//  - A plain GET never returns `icon`, even when the place has one.
//  - An empty `description` is absent, not `""` or `null`.

describe(parseAssetResponse, () => {
	it("should parse a captured plain GET of a place", ({ expect }) => {
		expect.assertions(1);

		const body = loadFixture("assets", "get-place-response.json");

		const result = parseAssetResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data).toStrictEqual({ assetId: "456", moderationState: "Approved" });
	});
});
