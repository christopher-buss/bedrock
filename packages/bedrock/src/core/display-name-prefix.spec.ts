import { describe, expect, it } from "vitest";

import { DEFAULT_PREFIX_FORMAT, renderDisplayNamePrefix } from "./display-name-prefix.ts";

describe(renderDisplayNamePrefix, () => {
	it("should apply the default template that wraps the label in uppercase brackets with a trailing space", () => {
		expect.assertions(1);

		expect(renderDisplayNamePrefix("staging")).toBe("[STAGING] ");
	});

	it("should expose the default template as DEFAULT_PREFIX_FORMAT for callers that need it", () => {
		expect.assertions(1);

		expect(DEFAULT_PREFIX_FORMAT).toBe("[{LABEL}] ");
	});

	it("should substitute {label} with the label as written", () => {
		expect.assertions(1);

		expect(renderDisplayNamePrefix("staging", "{label}: ")).toBe("staging: ");
	});

	it("should substitute {LABEL} with the upper-cased label", () => {
		expect.assertions(1);

		expect(renderDisplayNamePrefix("staging", "{LABEL}: ")).toBe("STAGING: ");
	});

	it("should substitute {Label} with the capitalized label", () => {
		expect.assertions(1);

		expect(renderDisplayNamePrefix("staging", "{Label}: ")).toBe("Staging: ");
	});

	it("should preserve the rest of the label when capitalizing so mixed-case input is not lower-cased", () => {
		expect.assertions(1);

		expect(renderDisplayNamePrefix("ABC", "{Label}")).toBe("ABC");
	});

	it("should handle a single-character label when capitalizing", () => {
		expect.assertions(1);

		expect(renderDisplayNamePrefix("a", "{Label}")).toBe("A");
	});

	it("should leave an empty label producing an empty placeholder substitution", () => {
		expect.assertions(1);

		expect(renderDisplayNamePrefix("", "[{LABEL}] ")).toBe("[] ");
	});

	it("should substitute multiple placeholders independently in the same template", () => {
		expect.assertions(1);

		expect(renderDisplayNamePrefix("dev", "{LABEL}-{Label}-{label}")).toBe("DEV-Dev-dev");
	});

	it("should preserve characters between placeholders verbatim", () => {
		expect.assertions(1);

		expect(renderDisplayNamePrefix("dev", "<<{label}>> ")).toBe("<<dev>> ");
	});

	it("should return the format unchanged when no placeholders appear", () => {
		expect.assertions(1);

		expect(renderDisplayNamePrefix("anything", "static-prefix-")).toBe("static-prefix-");
	});

	it("should not interpret braces around unrecognized casings such as {LaBeL} as placeholders", () => {
		expect.assertions(1);

		expect(renderDisplayNamePrefix("dev", "{LaBeL} ")).toBe("{LaBeL} ");
	});
});
