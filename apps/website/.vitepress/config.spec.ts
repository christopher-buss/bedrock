import { fromPartial } from "@total-typescript/shoehorn";

import { describe, expect, it } from "vitest";

import config from "./config.ts";

type HeadContext = Parameters<NonNullable<typeof config.transformHead>>[0];

async function robotsMetaFor(relativePath: string): Promise<unknown> {
	return config.transformHead?.(fromPartial<HeadContext>({ pageData: { relativePath } }));
}

describe("transformHead", () => {
	it("should leave the landing page open to search engines", async () => {
		expect.assertions(1);

		await expect(robotsMetaFor("index.md")).resolves.toStrictEqual([]);
	});

	it.for(["bedrock/guide/getting-started.md", "ocale/guide/errors.md", "bedrock/api/index.md"])(
		"should keep %s out of search engines",
		async (relativePath) => {
			expect.assertions(1);

			await expect(robotsMetaFor(relativePath)).resolves.toStrictEqual([
				["meta", { name: "robots", content: "noindex, nofollow" }],
			]);
		},
	);
});
