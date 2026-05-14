import { describe, expect, it } from "vitest";

import {
	isRedactedIconPath,
	REDACTED_ICON_BYTES,
	REDACTED_ICON_PATH,
	withRedactedIcon,
} from "./redacted-icon.ts";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("embedded redacted-icon bytes", () => {
	it("should start with the eight-byte PNG signature", () => {
		expect.assertions(1);
		expect(Array.from(REDACTED_ICON_BYTES.slice(0, 8))).toStrictEqual(PNG_SIGNATURE);
	});

	it("should declare a 64x64 raster in its header chunk", () => {
		expect.assertions(2);

		const view = new DataView(
			REDACTED_ICON_BYTES.buffer,
			REDACTED_ICON_BYTES.byteOffset,
			REDACTED_ICON_BYTES.byteLength,
		);

		expect(view.getUint32(16, false)).toBe(64);
		expect(view.getUint32(20, false)).toBe(64);
	});
});

describe(isRedactedIconPath, () => {
	it("should return true for the sentinel path", () => {
		expect.assertions(1);
		expect(isRedactedIconPath(REDACTED_ICON_PATH)).toBeTrue();
	});

	it("should return false for an ordinary file path", () => {
		expect.assertions(1);
		expect(isRedactedIconPath("assets/vip-icon.png")).toBeFalse();
	});

	it("should return false for an empty string", () => {
		expect.assertions(1);
		expect(isRedactedIconPath("")).toBeFalse();
	});
});

describe(withRedactedIcon, () => {
	it("should resolve the sentinel to REDACTED_ICON_BYTES without invoking the inner reader", async () => {
		expect.assertions(2);

		const calls: Array<string> = [];
		const wrapped = withRedactedIcon(async (path) => {
			calls.push(path);
			throw new Error("inner reader must not run");
		});

		const bytes = await wrapped(REDACTED_ICON_PATH);

		expect(bytes).toBe(REDACTED_ICON_BYTES);
		expect(calls).toBeEmpty();
	});

	it("should delegate every other path to the inner reader unchanged", async () => {
		expect.assertions(2);

		const calls: Array<string> = [];
		const payload = new Uint8Array([1, 2, 3]);
		const wrapped = withRedactedIcon(async (path) => {
			calls.push(path);
			return payload;
		});

		const bytes = await wrapped("assets/vip-icon.png");

		expect(bytes).toBe(payload);
		expect(calls).toStrictEqual(["assets/vip-icon.png"]);
	});

	it("should propagate rejections from the inner reader for non-sentinel paths", async () => {
		expect.assertions(1);

		const wrapped = withRedactedIcon(async () => {
			throw new Error("ENOENT");
		});

		await expect(wrapped("assets/missing.png")).rejects.toThrowWithMessage(Error, "ENOENT");
	});
});
