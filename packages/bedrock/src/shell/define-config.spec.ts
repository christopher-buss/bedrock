import { describe, expect, it } from "vitest";

import type { Config } from "../core/schema.ts";
import { defineConfig } from "./define-config.ts";

const BASE_CONFIG: Config = {
	passes: {
		"vip-pass": {
			name: "VIP Pass",
			description: "Grants VIP perks.",
			iconFilePath: "assets/vip-icon.png",
			price: 500,
		},
	},
};

describe(defineConfig, () => {
	it("should return a config object by identity", () => {
		expect.assertions(1);

		expect(defineConfig(BASE_CONFIG)).toBe(BASE_CONFIG);
	});

	it("should return a synchronous config function by identity", () => {
		expect.assertions(1);

		function build(): Config {
			return BASE_CONFIG;
		}

		expect(defineConfig(build)).toBe(build);
	});

	it("should return an asynchronous config function by identity", () => {
		expect.assertions(1);

		async function build(): Promise<Config> {
			return BASE_CONFIG;
		}

		expect(defineConfig(build)).toBe(build);
	});
});
