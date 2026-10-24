import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

import { LUAU_CONFIG_SOURCE } from "./config-source.ts";

describe("lUAU_CONFIG_SOURCE", () => {
	it("should hold the config.luau file verbatim", ({ expect }) => {
		expect.assertions(1);

		const onDisk = readFileSync(new URL("config.luau", import.meta.url), "utf8");

		expect(LUAU_CONFIG_SOURCE).toBe(onDisk);
	});
});
