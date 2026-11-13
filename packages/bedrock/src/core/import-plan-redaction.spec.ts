import { describe, it } from "vitest";

import { asRobloxAssetId } from "../types/ids.ts";
import { planImport } from "./import-plan.ts";
import type { LiveSnapshot, ResourceLiveState } from "./live-state.ts";
import { defaultRedactedProductName } from "./redact-resources.ts";
import type { Config, RedactedEnvironmentOverride } from "./schema.ts";

const SOURCE_ICON = asRobloxAssetId("555");
const PLACEHOLDER_ICON = asRobloxAssetId("777");

function livePass(
	fields: Partial<ResourceLiveState<"gamePass">> = {},
): ResourceLiveState<"gamePass"> {
	return {
		name: "VIP Pass",
		description: "Perks.",
		isManagedPricingEnabled: false,
		kind: "gamePass",
		outputs: { iconAssetIds: { "en-us": SOURCE_ICON } },
		price: 100,
		...fields,
	};
}

function liveProduct(
	fields: Partial<ResourceLiveState<"developerProduct">> = {},
): ResourceLiveState<"developerProduct"> {
	return {
		name: "Coins",
		description: "Shiny.",
		isManagedPricingEnabled: false,
		kind: "developerProduct",
		outputs: { iconImageAssetId: SOURCE_ICON },
		price: 10,
		...fields,
	};
}

function liveBadge(fields: Partial<ResourceLiveState<"badge">> = {}): ResourceLiveState<"badge"> {
	return {
		name: "Winner",
		description: "Won.",
		enabled: true,
		kind: "badge",
		outputs: { iconImageId: SOURCE_ICON },
		...fields,
	};
}

function snapshot<Kind extends "badge" | "developerProduct" | "gamePass">(
	kind: Kind,
	...entries: ReadonlyArray<readonly [string, ResourceLiveState<Kind>]>
): LiveSnapshot {
	return { [kind]: new Map(entries.map(([id, live]) => [asRobloxAssetId(id), live] as const)) };
}

function configWith(redacted: boolean | RedactedEnvironmentOverride): Config {
	return {
		environments: { production: {}, staging: { redacted } },
		universe: { universeId: "1" },
	};
}

const SOURCE_ID = asRobloxAssetId("11");
const LINKED_ID = asRobloxAssetId("21");

function differencesFor(
	config: Config,
	{
		kind,
		live,
		staged,
	}: {
		kind: "badge" | "developerProduct" | "gamePass";
		live: LiveSnapshot;
		staged: LiveSnapshot;
	},
) {
	const plan = planImport({
		config,
		environment: "production",
		linkLive: { staging: staged },
		live,
		selections: [{ kind, links: { staging: LINKED_ID }, robloxId: SOURCE_ID }],
	});
	return plan.links[0]?.candidates[0]?.differences;
}

describe("planImport in redacted Environments", () => {
	it("should show no difference for a link whose live game pass holds the placeholders", ({
		expect,
	}) => {
		expect.assertions(1);

		const differences = differencesFor(configWith(true), {
			kind: "gamePass",
			live: snapshot("gamePass", ["11", livePass()]),
			staged: snapshot("gamePass", [
				"21",
				livePass({
					name: "Redacted Pass",
					description: "",
					outputs: { iconAssetIds: { "en-us": PLACEHOLDER_ICON } },
					price: 99_999,
				}),
			]),
		});

		expect(differences).toStrictEqual([]);
	});

	it("should keep an off-sale game pass off sale in a redacted Environment's link", ({
		expect,
	}) => {
		expect.assertions(1);

		const differences = differencesFor(configWith(true), {
			kind: "gamePass",
			live: snapshot("gamePass", ["11", livePass({ price: undefined })]),
			staged: snapshot("gamePass", [
				"21",
				livePass({ name: "Redacted Pass", description: "", price: undefined }),
			]),
		});

		expect(differences).toStrictEqual([]);
	});

	it("should compare a link with the placeholders the Environment's override sets", ({
		expect,
	}) => {
		expect.assertions(1);

		const differences = differencesFor(configWith({ name: "Soon", price: 5 }), {
			kind: "gamePass",
			live: snapshot("gamePass", ["11", livePass()]),
			staged: snapshot("gamePass", ["21", livePass({ description: "", price: 5 })]),
		});

		expect(differences).toStrictEqual([{ config: "Soon", field: "name", live: "VIP Pass" }]);
	});

	it("should show no difference for a link whose live developer product holds the placeholders", ({
		expect,
	}) => {
		expect.assertions(1);

		const differences = differencesFor(configWith(true), {
			kind: "developerProduct",
			live: snapshot("developerProduct", ["11", liveProduct()]),
			staged: snapshot("developerProduct", [
				"21",
				liveProduct({
					name: defaultRedactedProductName("coins"),
					description: "",
					outputs: { iconImageAssetId: PLACEHOLDER_ICON },
					price: 99_999,
				}),
			]),
		});

		expect(differences).toStrictEqual([]);
	});

	it("should show no difference for a link whose live badge holds the placeholders", ({
		expect,
	}) => {
		expect.assertions(1);

		const differences = differencesFor(configWith(true), {
			kind: "badge",
			live: snapshot("badge", ["11", liveBadge()]),
			staged: snapshot("badge", [
				"21",
				liveBadge({
					name: "Redacted Badge",
					description: "",
					outputs: { iconImageId: PLACEHOLDER_ICON },
				}),
			]),
		});

		expect(differences).toStrictEqual([]);
	});

	it("should compare a link in an Environment that turns redaction off with the real values", ({
		expect,
	}) => {
		expect.assertions(1);

		const differences = differencesFor(configWith(false), {
			kind: "gamePass",
			live: snapshot("gamePass", ["11", livePass()]),
			staged: snapshot("gamePass", [
				"21",
				livePass({
					outputs: { iconAssetIds: { "en-us": PLACEHOLDER_ICON } },
					price: 99_999,
				}),
			]),
		});

		expect(differences).toStrictEqual([
			{ config: "assets/passes/vip-pass.png", field: "icon", live: PLACEHOLDER_ICON },
			{ config: 100, field: "price", live: 99_999 },
		]);
	});

	it.for([
		{ name: "Redacted Pass", kind: "gamePass", live: livePass({ name: "Redacted Pass" }) },
		{ name: "Redacted Badge", kind: "badge", live: liveBadge({ name: "Redacted Badge" }) },
		{
			name: "Hidden Product 0a1b2c",
			kind: "developerProduct",
			live: liveProduct({ name: "Hidden Product 0a1b2c" }),
		},
	] as const)(
		"should refuse a $kind whose name is the placeholder of a redacted source Environment",
		({ name, kind, live }, { expect }) => {
			expect.assertions(2);

			const plan = planImport({
				config: {
					environments: { production: { redacted: true } },
					universe: { universeId: "1" },
				},
				environment: "production",
				live: { [kind]: new Map([[SOURCE_ID, live]]) },
				selections: [{ kind, robloxId: SOURCE_ID }],
			});

			expect(plan.edits).toStrictEqual([]);
			expect(plan.refused).toStrictEqual([
				{
					kind,
					message: `${kind} 11 "${name}" has the redaction placeholder of "production" as its name. Give it its real name on Roblox, then import it.`,
					reason: "placeholder",
					robloxId: SOURCE_ID,
				},
			]);
		},
	);

	it("should refuse only a name equal to the placeholder name the source Environment's override sets", ({
		expect,
	}) => {
		expect.assertions(1);

		const plan = planImport({
			config: {
				environments: { production: { redacted: { name: "Soon" } } },
				universe: { universeId: "1" },
			},
			environment: "production",
			live: snapshot(
				"gamePass",
				["11", livePass({ name: "Soon" })],
				["12", livePass({ name: "Redacted Pass" })],
			),
			selections: [
				{ kind: "gamePass", robloxId: SOURCE_ID },
				{ kind: "gamePass", robloxId: asRobloxAssetId("12") },
			],
		});

		expect(plan.refused.map(({ reason, robloxId }) => [reason, robloxId])).toStrictEqual([
			["placeholder", "11"],
		]);
	});

	it.for([
		{ name: "Redacted Pass", redacted: false },
		{ name: "Hidden Product 0a1b2c", redacted: true },
		{ name: "Hidden Product 0a1b2", redacted: true },
		{ name: "My Hidden Product 0a1b2c", redacted: true },
		{ name: "Hidden Product 0a1b2c!", redacted: true },
	])(
		"should import a game pass named $name when the source redaction is $redacted",
		({ name, redacted }, { expect }) => {
			expect.assertions(1);

			const plan = planImport({
				config: {
					environments: { production: { redacted } },
					universe: { universeId: "1" },
				},
				environment: "production",
				live: snapshot("gamePass", ["11", livePass({ name })]),
				selections: [{ kind: "gamePass", robloxId: SOURCE_ID }],
			});

			expect(plan.refused).toStrictEqual([]);
		},
	);

	it.for(["Hidden Product 0a1b2", "My Hidden Product 0a1b2c", "Hidden Product 0a1b2c!"])(
		"should import a developer product named %s from a redacted Environment",
		(name, { expect }) => {
			expect.assertions(1);

			const plan = planImport({
				config: {
					environments: { production: { redacted: true } },
					universe: { universeId: "1" },
				},
				environment: "production",
				live: snapshot("developerProduct", ["11", liveProduct({ name })]),
				selections: [{ kind: "developerProduct", robloxId: SOURCE_ID }],
			});

			expect(plan.refused).toStrictEqual([]);
		},
	);

	it.for([
		{ marked: [true], redacted: true },
		{ marked: [true], redacted: { price: 5 } },
		{ marked: [undefined], redacted: false },
	] as const)(
		"should mark each item the source Environment redacts when redacted is $redacted",
		({ marked, redacted }, { expect }) => {
			expect.assertions(1);

			const plan = planImport({
				config: {
					environments: { production: { redacted } },
					universe: { universeId: "1" },
				},
				environment: "production",
				live: snapshot("gamePass", ["11", livePass()]),
			});

			expect(plan.items.map((item) => item.redacted)).toStrictEqual(marked);
		},
	);
});
