import { assert, describe, it } from "vitest";

import { loadFixture } from "#tests/conformance/_helpers";
import { parseIconListResponse } from "./parsers.ts";

// Captured against the live Open Cloud API at apis.roblox.com in
// 2026-10 for a universe still on the default icon; the CDN hash in
// imageUrl is zeroed, otherwise the shape is verbatim. The default icon
// comes back with `"imageId": null`.

describe(parseIconListResponse, () => {
	it("should parse a captured LIST 200 whose default icon has a null image id", ({ expect }) => {
		expect.assertions(1);

		const body = loadFixture("universes", "list-icons-response.json");

		const result = parseIconListResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data).toStrictEqual([
			{
				imageId: undefined,
				imageUrl: "https://t7.rbxcdn.com/180DAY-00000000000000000000000000000000",
				languageCode: "en",
				state: "Approved",
			},
		]);
	});
});
