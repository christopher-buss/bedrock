import { describe, it } from "vitest";

import { environmentPrefix, withoutPrefix } from "./environment-prefix.ts";

describe(environmentPrefix, () => {
	it("should render the configured format with the Environment label", ({ expect }) => {
		expect.assertions(1);

		const prefix = environmentPrefix(
			{
				displayNamePrefix: { format: "{label} - " },
				environments: { staging: { label: "dev" } },
			},
			"staging",
		);

		expect(prefix).toBe("dev - ");
	});

	it("should render no prefix without a label, when disabled, or for an unknown Environment", ({
		expect,
	}) => {
		expect.assertions(3);

		expect(environmentPrefix({ environments: { production: {} } }, "production")).toBe("");
		expect(
			environmentPrefix(
				{ displayNamePrefix: { enabled: false }, environments: { dev: { label: "dev" } } },
				"dev",
			),
		).toBe("");
		expect(environmentPrefix({ environments: {} }, "missing")).toBe("");
	});
});

describe(withoutPrefix, () => {
	it("should remove the prefix only where the name starts with it", ({ expect }) => {
		expect.assertions(3);

		expect(withoutPrefix("[DEV] VIP Pass", "[DEV] ")).toBe("VIP Pass");
		expect(withoutPrefix("[NEW] VIP Pass", "[DEV] ")).toBe("[NEW] VIP Pass");
		expect(withoutPrefix("[DEV] VIP Pass", "")).toBe("[DEV] VIP Pass");
	});
});
