import { assert, describe, expect, it } from "vitest";

import { asResourceKey } from "../../types/ids.ts";
import { REDACTED_ICON_BYTES, REDACTED_ICON_PATH } from "../redacted-icon.ts";
import { readBytesAsync } from "./read-bytes.ts";

describe(readBytesAsync, () => {
	it("should return the bytes the injected reader produces for an ordinary path", async () => {
		expect.assertions(2);

		const calls: Array<string> = [];
		const result = await readBytesAsync(
			{ key: asResourceKey("vip-pass"), filePath: "assets/vip.png" },
			{
				readFile: async (path) => {
					calls.push(path);
					return new Uint8Array([1, 2, 3]);
				},
			},
		);

		assert(result.success);

		expect(result.data).toStrictEqual(new Uint8Array([1, 2, 3]));
		expect(calls).toStrictEqual(["assets/vip.png"]);
	});

	it("should surface fileReadFailed carrying the file path and key when the injected reader rejects", async () => {
		expect.assertions(1);

		const result = await readBytesAsync(
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

	it("should carry the read rejection's cause chain into the failure reason", async () => {
		expect.assertions(1);

		const result = await readBytesAsync(
			{ key: asResourceKey("vip-pass"), filePath: "assets/missing.png" },
			{
				readFile: async () => {
					throw new Error("read failed", { cause: new Error("EACCES: denied") });
				},
			},
		);

		assert(!result.success);
		assert(result.err.kind === "fileReadFailed");

		expect(result.err.reason).toBe("read failed; caused by: EACCES: denied");
	});

	it("should short-circuit the redacted-icon sentinel to a fresh copy of embedded bytes without invoking the reader", async () => {
		expect.assertions(3);

		const calls: Array<string> = [];
		const result = await readBytesAsync(
			{ key: asResourceKey("vip-pass"), filePath: REDACTED_ICON_PATH },
			{
				readFile: async (path) => {
					calls.push(path);
					throw new Error("injected reader must not run for the sentinel");
				},
			},
		);

		assert(result.success);

		expect(result.data).toStrictEqual(REDACTED_ICON_BYTES);
		expect(result.data).not.toBe(REDACTED_ICON_BYTES);
		expect(calls).toBeEmpty();
	});
});
