import { assert, describe, expect, it } from "vitest";

import { asResourceKey, asSha256Hex } from "../types/ids.ts";
import { hashIconFile, hashIconLocales, iconHashesEqual, shouldReuploadIcon } from "./icons.ts";

const HASH_A = asSha256Hex("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
const HASH_B = asSha256Hex("2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881");

describe(hashIconFile, () => {
	it("should return the branded sha256 hex digest of the icon bytes", async () => {
		expect.assertions(1);

		const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
		const result = await hashIconFile(
			{ key: asResourceKey("vip-pass"), filePath: "assets/icon.png" },
			{ readFile: async () => bytes },
		);

		assert(result.success);

		expect(result.data).toBe(
			asSha256Hex("0f4636c78f65d3639ece5a064b5ae753e3408614a14fb18ab4d7540d2c248543"),
		);
	});

	it("should surface a fileReadFailed error carrying the file path and key when readFile rejects", async () => {
		expect.assertions(1);

		const result = await hashIconFile(
			{ key: asResourceKey("vip-pass"), filePath: "assets/missing.png" },
			{
				readFile: async () => {
					throw new Error("ENOENT");
				},
			},
		);

		assert(!result.success);

		expect(result.err).toStrictEqual({
			key: asResourceKey("vip-pass"),
			filePath: "assets/missing.png",
			kind: "fileReadFailed",
			reason: "ENOENT",
		});
	});
});

describe(hashIconLocales, () => {
	it("should hash every declared locale by delegating to hashIconFile", async () => {
		expect.assertions(2);

		const calls: Array<string> = [];
		const result = await hashIconLocales(
			{
				key: asResourceKey("vip-pass"),
				icon: { "en-us": "assets/vip-en.png" },
			},
			{
				readFile: async (path) => {
					calls.push(path);
					return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
				},
			},
		);

		assert(result.success);

		expect(result.data["en-us"]).toMatch(/^[0-9a-f]{64}$/);
		expect(calls).toStrictEqual(["assets/vip-en.png"]);
	});

	it("should propagate fileReadFailed from the underlying hashIconFile call", async () => {
		expect.assertions(1);

		const result = await hashIconLocales(
			{
				key: asResourceKey("vip-pass"),
				icon: { "en-us": "assets/missing.png" },
			},
			{
				readFile: async () => {
					throw new Error("ENOENT");
				},
			},
		);

		assert(!result.success);

		expect(result.err).toStrictEqual({
			key: asResourceKey("vip-pass"),
			filePath: "assets/missing.png",
			kind: "fileReadFailed",
			reason: "ENOENT",
		});
	});
});

describe(iconHashesEqual, () => {
	it("should return true when both sides are undefined", () => {
		expect.assertions(1);

		expect(iconHashesEqual(undefined, undefined)).toBeTrue();
	});

	it("should return false when desired is undefined and current is present", () => {
		expect.assertions(1);

		expect(iconHashesEqual({ "en-us": HASH_A }, undefined)).toBeFalse();
	});

	it("should return false when current is undefined and desired is present", () => {
		expect.assertions(1);

		expect(iconHashesEqual(undefined, { "en-us": HASH_A })).toBeFalse();
	});

	it("should return true when both sides carry the same en-us hash", () => {
		expect.assertions(1);

		expect(iconHashesEqual({ "en-us": HASH_A }, { "en-us": HASH_A })).toBeTrue();
	});

	it("should return false when the en-us hash differs across sides", () => {
		expect.assertions(1);

		expect(iconHashesEqual({ "en-us": HASH_A }, { "en-us": HASH_B })).toBeFalse();
	});
});

describe(shouldReuploadIcon, () => {
	it("should return true when the desired hash differs from the current hash", () => {
		expect.assertions(1);

		expect(shouldReuploadIcon({ "en-us": HASH_A }, { "en-us": HASH_B })).toBeTrue();
	});

	it("should return false when the desired hash matches the current hash", () => {
		expect.assertions(1);

		expect(shouldReuploadIcon({ "en-us": HASH_A }, { "en-us": HASH_A })).toBeFalse();
	});

	it("should return true when the current hash is undefined and the desired hash is present", () => {
		expect.assertions(1);

		expect(shouldReuploadIcon(undefined, { "en-us": HASH_A })).toBeTrue();
	});

	it("should return true when the desired hash is undefined and the current hash is present", () => {
		expect.assertions(1);

		expect(shouldReuploadIcon({ "en-us": HASH_A }, undefined)).toBeTrue();
	});

	it("should return false when both sides are undefined", () => {
		expect.assertions(1);

		expect(shouldReuploadIcon(undefined, undefined)).toBeFalse();
	});
});
