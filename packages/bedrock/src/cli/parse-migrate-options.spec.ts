import { describe, expect, it } from "vitest";

import {
	type ParseMigrateError,
	parseMigrateOptions,
	SUPPORTED_MIGRATION_SOURCES,
} from "./parse-migrate-options.ts";

describe(parseMigrateOptions, () => {
	it("should return Ok with the parsed source on --from mantle", () => {
		expect.assertions(1);

		const result = parseMigrateOptions({ from: "mantle" });

		expect(result).toStrictEqual({ data: { from: "mantle" }, success: true });
	});

	it("should ignore the sade-reserved underscore positional bag", () => {
		expect.assertions(1);

		const result = parseMigrateOptions({ _: ["./.mantle-state.yml"], from: "mantle" });

		expect(result).toStrictEqual({ data: { from: "mantle" }, success: true });
	});

	it("should return Ok with from: undefined when --from is omitted", () => {
		expect.assertions(1);

		const result = parseMigrateOptions({});

		expect(result).toStrictEqual({ data: { from: undefined }, success: true });
	});

	it.for<{ expected: ParseMigrateError; label: string; rawOptions: Record<string, unknown> }>([
		{
			expected: { flag: "from", kind: "invalidValue" },
			label: "non-string --from",
			rawOptions: { from: false },
		},
		{
			expected: {
				kind: "unknownSource",
				received: "universe",
				supported: SUPPORTED_MIGRATION_SOURCES,
			},
			label: "--from value outside SUPPORTED_MIGRATION_SOURCES",
			rawOptions: { from: "universe" },
		},
		{
			expected: { flag: "verbose", kind: "unknownFlag" },
			label: "unknown flag",
			rawOptions: { from: "mantle", verbose: true },
		},
	])("should reject $label with the matching error variant", ({ expected, rawOptions }) => {
		expect.assertions(1);

		const result = parseMigrateOptions(rawOptions);

		expect(result).toStrictEqual({ err: expected, success: false });
	});
});
