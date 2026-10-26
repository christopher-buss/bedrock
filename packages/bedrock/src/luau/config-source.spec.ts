import { HAS_LUTE } from "@bedrock-rbx/testing/lute";

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

import { LUAU_CONFIG_SOURCE } from "./config-source.ts";

const overridePath = process.env["BEDROCK_LUTE_PATH"];
const lute = overridePath !== undefined && overridePath.length > 0 ? overridePath : "lute";

describe("lUAU_CONFIG_SOURCE", () => {
	it.skipIf(!HAS_LUTE)(
		"should typecheck managed pricing in Luau entries and overlays",
		({ expect }) => {
			expect.assertions(1);

			const fixture = fileURLToPath(
				new URL("../../tests/fixtures/managed-pricing.luau", import.meta.url),
			);

			expect(() => {
				return execFileSync(lute, ["check", fixture], { encoding: "utf8" });
			}).not.toThrow();
		},
	);

	it("should hold the config.luau file verbatim", ({ expect }) => {
		expect.assertions(1);

		const onDisk = readFileSync(new URL("config.luau", import.meta.url), "utf8");

		expect(LUAU_CONFIG_SOURCE).toBe(onDisk);
	});
});
