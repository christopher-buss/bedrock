import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { matchesSignature, RBXL_SIGNATURE, RBXLX_SIGNATURE } from "./signatures.ts";

const FIXTURES = fileURLToPath(new URL("../../../tests/fixtures/places/", import.meta.url));

function loadFixture(name: string): Uint8Array {
	const buffer = readFileSync(`${FIXTURES}${name}`);
	return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

describe("rBXL_SIGNATURE", () => {
	it("should match the leading bytes of a real rbxl fixture", () => {
		expect.assertions(1);

		const fixture = loadFixture("minimal.rbxl");

		expect(fixture.subarray(0, RBXL_SIGNATURE.length)).toStrictEqual(
			new Uint8Array(RBXL_SIGNATURE),
		);
	});
});

describe("rBXLX_SIGNATURE", () => {
	it("should match the leading bytes of a real rbxlx fixture", () => {
		expect.assertions(1);

		const fixture = loadFixture("minimal.rbxlx");

		expect(fixture.subarray(0, RBXLX_SIGNATURE.length)).toStrictEqual(
			new Uint8Array(RBXLX_SIGNATURE),
		);
	});
});

describe(matchesSignature, () => {
	it("should return true when the body is byte-identical to the signature", () => {
		expect.assertions(1);

		expect(matchesSignature(new Uint8Array(RBXL_SIGNATURE), RBXL_SIGNATURE)).toBeTrue();
	});

	it("should return true when the body extends past the signature with arbitrary bytes", () => {
		expect.assertions(1);

		const body = new Uint8Array([...RBXL_SIGNATURE, 0x42, 0x42, 0x42]);

		expect(matchesSignature(body, RBXL_SIGNATURE)).toBeTrue();
	});

	it("should return false when the body is shorter than the signature", () => {
		expect.assertions(1);

		const body = new Uint8Array(RBXL_SIGNATURE).subarray(0, RBXL_SIGNATURE.length - 1);

		expect(matchesSignature(body, RBXL_SIGNATURE)).toBeFalse();
	});

	it("should return false when a single byte differs from the signature", () => {
		expect.assertions(1);

		const body = new Uint8Array(RBXL_SIGNATURE);
		body[7] = 0x20;

		expect(matchesSignature(body, RBXL_SIGNATURE)).toBeFalse();
	});

	it("should return false when an rbxlx-prefix body is checked against the rbxl signature", () => {
		expect.assertions(1);

		expect(matchesSignature(new Uint8Array(RBXLX_SIGNATURE), RBXL_SIGNATURE)).toBeFalse();
	});
});
