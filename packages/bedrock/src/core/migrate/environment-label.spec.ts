import { describe, expect, it } from "vitest";

import { asRobloxAssetId, asSha256Hex } from "../../types/ids.ts";
import { computeEnvironmentLabel } from "./environment-label.ts";
import type { EnvironmentFoldResult } from "./fold-environment.ts";
import type { PlaceFoldEntry } from "./fold-places.ts";

const VALID_HASH = asSha256Hex("908498abb7f4fca2b7d2b050bfe7c48c009202fabd85f489b03bb19ac6e0b1d9");

function placeFold(displayName: string | undefined): PlaceFoldEntry {
	return {
		entry:
			displayName === undefined
				? { filePath: "place.rbxl" }
				: { displayName, filePath: "place.rbxl" },
		fileHash: VALID_HASH,
		outputs: { versionNumber: 53 },
		placeId: "17613681043",
	};
}

function universeWithDisplayName(
	displayName: string | undefined,
): EnvironmentFoldResult["universe"] {
	return {
		entry:
			displayName === undefined
				? { universeId: "1234567890" }
				: { displayName, universeId: "1234567890" },
		outputs: { rootPlaceId: asRobloxAssetId("17613681043") },
	};
}

function fold(overrides: Partial<EnvironmentFoldResult> = {}): EnvironmentFoldResult {
	return {
		passes: [],
		places: new Map(),
		products: [],
		universe: undefined,
		warnings: [],
		...overrides,
	};
}

function withPlaces(
	places: ReadonlyArray<readonly [key: string, displayName: string | undefined]>,
): EnvironmentFoldResult {
	return fold({
		places: new Map(places.map(([key, displayName]) => [key, placeFold(displayName)])),
	});
}

describe(computeEnvironmentLabel, () => {
	it("should return the lowercased label when every place displayName shares the same bracketed prefix", () => {
		expect.assertions(1);

		const result = computeEnvironmentLabel(
			withPlaces([
				["start", "[DEVELOPMENT] Lobby"],
				["game", "[DEVELOPMENT] Match"],
			]),
		);

		expect(result).toBe("development");
	});

	it("should return undefined when every displayName lacks a bracketed prefix", () => {
		expect.assertions(1);

		const result = computeEnvironmentLabel(
			withPlaces([
				["start", "Lobby"],
				["game", "Match"],
			]),
		);

		expect(result).toBeUndefined();
	});

	it("should return undefined when display names mix prefixed and unprefixed entries", () => {
		expect.assertions(1);

		const result = computeEnvironmentLabel(
			withPlaces([
				["start", "Lobby"],
				["game", "[DEVELOPMENT] Match"],
			]),
		);

		expect(result).toBeUndefined();
	});

	it("should return undefined when display names carry differing bracketed prefixes", () => {
		expect.assertions(1);

		const result = computeEnvironmentLabel(
			withPlaces([
				["start", "[DEV] Lobby"],
				["game", "[STAGING] Match"],
			]),
		);

		expect(result).toBeUndefined();
	});

	it("should return undefined when the environment has no display names at all", () => {
		expect.assertions(1);

		const result = computeEnvironmentLabel(
			withPlaces([
				["start", undefined],
				["game", undefined],
			]),
		);

		expect(result).toBeUndefined();
	});

	it("should consider the universe displayName alongside place display names", () => {
		expect.assertions(1);

		const result = computeEnvironmentLabel(
			fold({
				places: new Map([["game", placeFold("[DEVELOPMENT] Match")]]),
				universe: universeWithDisplayName("[DEVELOPMENT] My Game"),
			}),
		);

		expect(result).toBe("development");
	});

	it("should return undefined when the universe and a place disagree on prefix", () => {
		expect.assertions(1);

		const result = computeEnvironmentLabel(
			fold({
				places: new Map([["game", placeFold("[DEV] Match")]]),
				universe: universeWithDisplayName("[DEVELOPMENT] My Game"),
			}),
		);

		expect(result).toBeUndefined();
	});

	it("should ignore places that have no displayName when computing consensus", () => {
		expect.assertions(1);

		const result = computeEnvironmentLabel(
			withPlaces([
				["start", undefined],
				["game", "[DEVELOPMENT] Match"],
			]),
		);

		expect(result).toBe("development");
	});
});
