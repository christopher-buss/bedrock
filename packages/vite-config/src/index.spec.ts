import { describe, expect, it } from "vitest";

import { sortExports } from "./index.ts";

describe(sortExports, () => {
	it("should pin the root export as the first entry", () => {
		expect.assertions(1);

		const result = sortExports({
			".": { default: "./dist/index.mjs" },
			"./places": { default: "./dist/places.mjs" },
			"./universes": { default: "./dist/universes.mjs" },
		});

		expect(Object.keys(result)).toStrictEqual([".", "./places", "./universes"]);
	});

	it("should sort ./package.json before subpaths that follow it alphabetically", () => {
		expect.assertions(1);

		const result = sortExports({
			".": { default: "./dist/index.mjs" },
			"./game-passes": { default: "./dist/game-passes.mjs" },
			"./package.json": "./package.json",
			"./places": { default: "./dist/places.mjs" },
			"./universes": { default: "./dist/universes.mjs" },
		});

		expect(Object.keys(result)).toStrictEqual([
			".",
			"./game-passes",
			"./package.json",
			"./places",
			"./universes",
		]);
	});

	it("should preserve the value associated with each entry", () => {
		expect.assertions(1);

		const result = sortExports({
			".": { default: "./dist/index.mjs", source: "./src/index.ts" },
			"./package.json": "./package.json",
			"./places": { default: "./dist/places.mjs", source: "./src/places.ts" },
		});

		expect(result).toStrictEqual({
			".": { default: "./dist/index.mjs", source: "./src/index.ts" },
			"./package.json": "./package.json",
			"./places": { default: "./dist/places.mjs", source: "./src/places.ts" },
		});
	});

	it("should return the same order for already-sorted input", () => {
		expect.assertions(1);

		const input = {
			".": { default: "./dist/index.mjs" },
			"./package.json": "./package.json",
			"./places": { default: "./dist/places.mjs" },
		};

		expect(Object.keys(sortExports(input))).toStrictEqual(Object.keys(input));
	});

	it("should return a single-entry map containing only the root export", () => {
		expect.assertions(1);

		const result = sortExports({ ".": { default: "./dist/index.mjs" } });

		expect(Object.keys(result)).toStrictEqual(["."]);
	});
});
