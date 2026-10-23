/* eslint-disable unicorn/no-null -- the scan exists to find the null values a config layer writes */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";

import { collectNullishIssues, findNullishResourcePaths } from "./find-nullish.ts";

describe(findNullishResourcePaths, () => {
	it("should report a null field inside an environment overlay", ({ expect }) => {
		expect.assertions(1);

		const paths = findNullishResourcePaths({
			environments: { staging: { products: { "gem-pack": { price: null } } } },
		});

		expect(paths).toStrictEqual([
			{ path: ["environments", "staging", "products", "gem-pack", "price"], value: null },
		]);
	});

	it("should report a present undefined field in a root section", ({ expect }) => {
		expect.assertions(1);

		const paths = findNullishResourcePaths({
			universe: { privateServerPriceRobux: undefined, universeId: "1" },
		});

		expect(paths).toStrictEqual([
			{ path: ["universe", "privateServerPriceRobux"], value: undefined },
		]);
	});

	it("should report a null nested below an entry field", ({ expect }) => {
		expect.assertions(1);

		const paths = findNullishResourcePaths({
			passes: { vip: { redacted: { price: null } } },
		});

		expect(paths).toStrictEqual([
			{ path: ["passes", "vip", "redacted", "price"], value: null },
		]);
	});

	it("should report a null resource section itself", ({ expect }) => {
		expect.assertions(1);

		expect(findNullishResourcePaths({ places: null })).toStrictEqual([
			{ path: ["places"], value: null },
		]);
	});

	it("should ignore absent sections and nullish values outside the resource sections", ({
		expect,
	}) => {
		expect.assertions(1);

		const paths = findNullishResourcePaths({
			codegen: { enabled: null },
			environments: { staging: { label: null, state: { region: null } } },
			state: { backend: "s3", region: null },
		});

		expect(paths).toStrictEqual([]);
	});

	it("should ignore a null environment entry and a non-object config", ({ expect }) => {
		expect.assertions(2);

		expect(findNullishResourcePaths({ environments: { staging: null } })).toStrictEqual([]);
		expect(findNullishResourcePaths(undefined)).toStrictEqual([]);
	});

	it("should not scan an array value", ({ expect }) => {
		expect.assertions(1);

		expect(findNullishResourcePaths({ passes: [null] })).toStrictEqual([]);
	});
});

describe(collectNullishIssues, () => {
	it("should name the layer file and the fix in each issue", ({ expect }) => {
		expect.assertions(1);

		const base = join(tmpdir(), "base.yaml");
		const issues = collectNullishIssues(
			[
				{ config: { passes: { vip: { price: 5 } } }, configFile: "bedrock.config" },
				{ config: { passes: { vip: { price: null } } }, configFile: base },
			],
			"bedrock.config.ts",
		);

		expect(issues).toStrictEqual([
			{
				message: `is null in ${base}: write \`$none\` to turn the field off, or remove the key to inherit it`,
				path: ["passes", "vip", "price"],
			},
		]);
	});
});

describe("collectNullishIssues hint", () => {
	const main = join(tmpdir(), "bedrock.config.ts");

	it.for([
		["passes", "vip", "price"],
		["environments", "dev", "products", "gems", "price"],
		["universe", "privateServerPriceRobux"],
		["environments", "dev", "universe", "discordSocialLink"],
	])("should suggest none for %s fields that accept it", (path, { expect }) => {
		expect.assertions(1);

		const config = path.reduceRight<unknown>((value, key) => ({ [key]: value }), null);
		const issues = collectNullishIssues([{ config }], main);

		expect(issues[0]!.message).toBe(
			`is null in ${main}: write \`$none\` to turn the field off, or remove the key to inherit it`,
		);
	});

	it.for([
		["places", "start", "serverSize"],
		["passes", "vip", "redacted", "price"],
		["passes", "vip", "price", "amount"],
		["universe", "displayName"],
		["places", "privateServerPriceRobux"],
		["environments", "dev", "universe", "discordSocialLink", "title"],
		["products", "gems", "name"],
	])("should not suggest none for %s fields that reject it", (path, { expect }) => {
		expect.assertions(1);

		const config = path.reduceRight<unknown>((value, key) => ({ [key]: value }), null);
		const issues = collectNullishIssues([{ config }], main);

		expect(issues[0]!.message).toBe(
			`is null in ${main}: remove the key to inherit it, or set a value`,
		);
	});
});

describe("collectNullishIssues file naming", () => {
	it("should name the main file for a layer recorded under a bare name", ({ expect }) => {
		expect.assertions(1);

		const main = join(tmpdir(), "bedrock.config.ts");
		const issues = collectNullishIssues(
			[{ config: { places: { start: { serverSize: null } } }, configFile: "bedrock.config" }],
			main,
		);

		expect(issues[0]!.message).toContain(`null in ${main}:`);
	});

	it("should name the main file for a layer with no file", ({ expect }) => {
		expect.assertions(1);

		const main = join(tmpdir(), "bedrock.config.ts");
		const issues = collectNullishIssues([{ config: { places: null } }], main);

		expect(issues[0]!.message).toContain(`null in ${main}:`);
	});
});
