import { describe, it } from "vitest";

import { decodeAssetContentAsync } from "#src/domains/asset-delivery/assets/content";
import { gzipAsync } from "#tests/helpers/gzip";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

describe(decodeAssetContentAsync, () => {
	it("should gunzip content that starts with the gzip magic bytes", async ({ expect }) => {
		expect.assertions(1);

		await expect(decodeAssetContentAsync(await gzipAsync(PNG))).resolves.toStrictEqual({
			data: PNG,
			success: true,
		});
	});

	it.for([
		{ bytes: PNG },
		{ bytes: new Uint8Array([0x1f, 0x00, 1]) },
		{ bytes: new Uint8Array([0x00, 0x8b, 1]) },
		{ bytes: new Uint8Array() },
	])(
		"should return content without the gzip magic bytes unchanged %#",
		async ({ bytes }, { expect }) => {
			expect.assertions(1);

			await expect(decodeAssetContentAsync(bytes)).resolves.toStrictEqual({
				data: bytes,
				success: true,
			});
		},
	);

	it("should fail on content with the gzip magic bytes that does not gunzip", async ({
		expect,
	}) => {
		expect.assertions(1);

		const result = await decodeAssetContentAsync(new Uint8Array([0x1f, 0x8b, 0, 0]));

		expect(result.success).toBe(false);
	});
});
