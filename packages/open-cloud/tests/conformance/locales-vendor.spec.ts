import { isRecord } from "#src/internal/utils/is-record";
import {
	ROBLOX_CREATOR_LOCALES,
	type RobloxLanguageCode,
	type RobloxLocale,
} from "#src/locales/index";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, expectTypeOf, it } from "vitest";

const VENDOR_JSON_URL = new URL("../../vendor/roblox-creator-locales.json", import.meta.url);

interface UpstreamProjection {
	readonly languageCode: string;
	readonly locale: string;
}

function readUpstream(): ReadonlyArray<UpstreamProjection> {
	const raw = JSON.parse(readFileSync(fileURLToPath(VENDOR_JSON_URL), "utf8"));
	assert(isRecord(raw) && Array.isArray(raw["data"]), "vendor JSON missing data array");

	return raw["data"].map((entry, index): UpstreamProjection => {
		assert(isRecord(entry), `entry ${String(index)}: not an object`);
		const { locale: localeNode } = entry;
		assert(isRecord(localeNode), `entry ${String(index)}: locale not an object`);
		const { locale } = localeNode;
		assert(typeof locale === "string", `entry ${String(index)}: locale.locale not a string`);
		const { language: languageNode } = localeNode;
		assert(isRecord(languageNode), `entry ${String(index)}: locale.language not an object`);
		const { languageCode } = languageNode;
		assert(
			typeof languageCode === "string",
			`entry ${String(index)}: locale.language.languageCode not a string`,
		);
		return { languageCode, locale };
	});
}

const upstream = readUpstream();

// Type-level pins: the union types must derive from the const exactly,
// so adding or removing a row in the vendor file is a typecheck.
expectTypeOf<RobloxLocale>().toEqualTypeOf<(typeof ROBLOX_CREATOR_LOCALES)[number]["locale"]>();
expectTypeOf<RobloxLanguageCode>().toEqualTypeOf<
	(typeof ROBLOX_CREATOR_LOCALES)[number]["languageCode"]
>();

describe("locales-vendor", () => {
	it("should mirror the vendor JSON entry count in the generated const", () => {
		expect.assertions(1);
		expect(ROBLOX_CREATOR_LOCALES).toHaveLength(upstream.length);
	});

	it("should expose every vendor JSON locale code on the const, in order", () => {
		expect.assertions(1);
		expect(ROBLOX_CREATOR_LOCALES.map((row) => row.locale)).toStrictEqual(
			upstream.map((row) => row.locale),
		);
	});

	it("should expose every vendor JSON language code on the const, in order", () => {
		expect.assertions(1);
		expect(ROBLOX_CREATOR_LOCALES.map((row) => row.languageCode)).toStrictEqual(
			upstream.map((row) => row.languageCode),
		);
	});

	it.for(ROBLOX_CREATOR_LOCALES)(
		"should encode locale $locale as Roblox's [a-z]{2,3}_[a-z0-9]{2,3} wire form",
		(row) => {
			expect.assertions(1);
			expect(row.locale).toMatch(/^[a-z]{2,3}_[a-z0-9]{2,3}$/);
		},
	);

	it.for(ROBLOX_CREATOR_LOCALES)(
		"should expose a non-empty languageCode for locale $locale",
		(row) => {
			expect.assertions(1);
			expect(row.languageCode).not.toBe("");
		},
	);
});
