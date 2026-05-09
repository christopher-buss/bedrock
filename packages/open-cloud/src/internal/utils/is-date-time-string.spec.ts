import { describe, expect, it } from "vitest";

import { isDateTimeString } from "./is-date-time-string.ts";

describe(isDateTimeString, () => {
	it("should accept an ISO 8601 UTC timestamp", () => {
		expect.assertions(1);

		expect(isDateTimeString("2024-01-15T10:30:00.000Z")).toBeTrue();
	});

	it("should accept a timestamp without fractional seconds", () => {
		expect.assertions(1);

		expect(isDateTimeString("2024-01-15T10:30:00Z")).toBeTrue();
	});

	it("should reject a string that does not parse to a real Date", () => {
		expect.assertions(1);

		expect(isDateTimeString("not-a-date")).toBeFalse();
	});

	it("should reject the literal string 'Invalid Date'", () => {
		expect.assertions(1);

		expect(isDateTimeString("Invalid Date")).toBeFalse();
	});

	it("should reject an empty string", () => {
		expect.assertions(1);

		expect(isDateTimeString("")).toBeFalse();
	});

	it("should reject a non-string number", () => {
		expect.assertions(1);

		expect(isDateTimeString(1_700_000_000_000)).toBeFalse();
	});

	it("should reject undefined", () => {
		expect.assertions(1);

		expect(isDateTimeString(undefined)).toBeFalse();
	});

	it("should reject a JSON null", () => {
		expect.assertions(1);

		expect(isDateTimeString(JSON.parse("null"))).toBeFalse();
	});

	it("should reject a Date instance, since the wire field is a string", () => {
		expect.assertions(1);

		expect(isDateTimeString(new Date("2024-01-15T10:30:00.000Z"))).toBeFalse();
	});
});
