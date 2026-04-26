import { describe, expect, it } from "vitest";

import { toBlob } from "./to-blob.ts";

describe(toBlob, () => {
	it("should return a Blob input unchanged so its MIME type is preserved", () => {
		expect.assertions(1);

		const original = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

		expect(toBlob(original)).toBe(original);
	});

	it("should wrap a Uint8Array into a fresh Blob preserving the byte length", () => {
		expect.assertions(2);

		const bytes = new Uint8Array([1, 2, 3, 4, 5]);

		const result = toBlob(bytes);

		expect(result).toBeInstanceOf(Blob);
		expect(result.size).toBe(bytes.byteLength);
	});

	it("should not share the underlying buffer when wrapping a Uint8Array", async () => {
		expect.assertions(1);

		const bytes = new Uint8Array([1, 2, 3, 4]);

		const result = toBlob(bytes);
		bytes[0] = 99;
		const observed = new Uint8Array(await result.arrayBuffer());

		expect(observed[0]).toBe(1);
	});
});
