import { loadConfig, migrateMantleState, selectEnvironment } from "@bedrock-rbx/core";

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it } from "vitest";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
// Walking up from a temp file inside the workspace tree finds @bedrock-rbx/core
// via the workspace root's node_modules, regardless of pnpm's hoist decisions.
// node_modules/.cache is the conventional location for tool ephemera and is
// already gitignored.
const WORKSPACE_TEMP_ROOT = join(
	dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
	"node_modules",
	".cache",
);
const REAL_FIXTURE = join(FIXTURES_ROOT, "roblox-ts-example.mantle-state.yml");
const ICON_FILE_SHA256 = "c2d4b446a44ce54fab8e01150e24dd24f3d850c7c14dcfe31f6321341dd86874";
const MANTLE_RECORDED_HASH = "86890ed405cabad0fcdabf52225d528981790fa551e915c070348761c28373c1";

const TWO_ENV_DIVERGENT_PRODUCT_YAML = [
	'version: "6"',
	"environments:",
	"  development:",
	"    - id: experience_singleton",
	"      inputs:",
	"        experience:",
	"          groupId: ~",
	"      outputs:",
	"        experience:",
	"          assetId: 1111111111",
	"          startPlaceId: 2222222222",
	"      dependencies: []",
	"    - id: product_gem-pack",
	"      inputs:",
	"        product:",
	"          name: Gem Pack",
	"          description: Stocks the player up with 1,000 premium gems.",
	"          price: ~",
	"      outputs:",
	"        product:",
	"          assetId: 1000",
	"          productId: 2000",
	"      dependencies:",
	"        - experience_singleton",
	"  production:",
	"    - id: experience_singleton",
	"      inputs:",
	"        experience:",
	"          groupId: ~",
	"      outputs:",
	"        experience:",
	"          assetId: 6031475575",
	"          startPlaceId: 17613681043",
	"      dependencies: []",
	"    - id: product_gem-pack",
	"      inputs:",
	"        product:",
	"          name: Gem Pack",
	"          description: Stocks the player up with 1,000 premium gems.",
	"          price: 100",
	"      outputs:",
	"        product:",
	"          assetId: 3000",
	"          productId: 4000",
	"      dependencies:",
	"        - experience_singleton",
	"",
].join("\n");

const TWO_ENV_DIVERGENT_PASS_YAML = [
	'version: "6"',
	"environments:",
	"  development:",
	"    - id: experience_singleton",
	"      inputs:",
	"        experience:",
	"          groupId: ~",
	"      outputs:",
	"        experience:",
	"          assetId: 1111111111",
	"          startPlaceId: 2222222222",
	"      dependencies: []",
	"    - id: pass_vip",
	"      inputs:",
	"        pass:",
	"          name: VIP Pass",
	"          description: Grants VIP perks.",
	"          price: 99",
	"          iconFilePath: assets/marketing/example-icon.png",
	`          iconFileHash: ${MANTLE_RECORDED_HASH}`,
	"      outputs:",
	"        pass:",
	"          assetId: 100",
	"          iconAssetId: 200",
	"      dependencies:",
	"        - experience_singleton",
	"  production:",
	"    - id: experience_singleton",
	"      inputs:",
	"        experience:",
	"          groupId: ~",
	"      outputs:",
	"        experience:",
	"          assetId: 6031475575",
	"          startPlaceId: 17613681043",
	"      dependencies: []",
	"    - id: pass_vip",
	"      inputs:",
	"        pass:",
	"          name: VIP Pass",
	"          description: Grants VIP perks.",
	"          price: 500",
	"          iconFilePath: assets/marketing/example-icon.png",
	`          iconFileHash: ${MANTLE_RECORDED_HASH}`,
	"      outputs:",
	"        pass:",
	"          assetId: 838516503",
	"          iconAssetId: 18109390296",
	"      dependencies:",
	"        - experience_singleton",
	"",
].join("\n");

async function withTemporaryDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
	mkdirSync(WORKSPACE_TEMP_ROOT, { recursive: true });
	const directory = mkdtempSync(join(WORKSPACE_TEMP_ROOT, "bedrock-migrate-"));
	try {
		return await run(directory);
	} finally {
		rmSync(directory, { force: true, recursive: true });
	}
}

describe(migrateMantleState, () => {
	it("should produce a config that round-trips through loadConfig from the emitted TypeScript", async () => {
		expect.assertions(2);

		const result = await migrateMantleState({
			configFormat: "typescript",
			primaryEnvironment: "production",
			stateFilePath: REAL_FIXTURE,
		});

		assert(result.success);

		await withTemporaryDirectory(async (directory) => {
			writeFileSync(join(directory, "bedrock.config.ts"), result.data.configFileContent);
			const loaded = await loadConfig({ cwd: directory });

			assert(loaded.success);

			expect(loaded.data).toStrictEqual(result.data.config);
			expect(loaded.data.environments["production"]?.universe?.universeId).toBe("6110424408");
		});
	});

	it("should produce a config that round-trips through loadConfig from the emitted YAML", async () => {
		expect.assertions(3);

		const typescriptRun = await migrateMantleState({
			configFormat: "typescript",
			primaryEnvironment: "production",
			stateFilePath: REAL_FIXTURE,
		});
		const yamlRun = await migrateMantleState({
			configFormat: "yaml",
			primaryEnvironment: "production",
			stateFilePath: REAL_FIXTURE,
		});

		assert(typescriptRun.success);
		assert(yamlRun.success);

		await withTemporaryDirectory(async (directory) => {
			writeFileSync(join(directory, "bedrock.config.yaml"), yamlRun.data.configFileContent);
			const loaded = await loadConfig({ cwd: directory });

			assert(loaded.success);

			expect(loaded.data).toStrictEqual(yamlRun.data.config);
			expect(loaded.data).toStrictEqual(typescriptRun.data.config);
			expect(loaded.data.environments["production"]?.universe?.universeId).toBe("6110424408");
		});
	});

	it("should produce one BedrockState per Mantle environment with the universe resource folded", async () => {
		expect.assertions(3);

		const result = await migrateMantleState({
			configFormat: "typescript",
			primaryEnvironment: "production",
			stateFilePath: REAL_FIXTURE,
		});

		assert(result.success);

		const { development, production } = result.data.statesByEnvironment;
		assert(development !== undefined && production !== undefined);

		const [developmentUniverse] = development.resources;
		const [productionUniverse] = production.resources;
		assert(developmentUniverse?.kind === "universe" && productionUniverse?.kind === "universe");

		expect(developmentUniverse.universeId).toBe("6031475575");
		expect(productionUniverse.universeId).toBe("6110424408");
		expect(productionUniverse.outputs.rootPlaceId).toBe("17834656300");
	});

	it("should preserve the production startPlaceId on the universe outputs", async () => {
		expect.assertions(1);

		const result = await migrateMantleState({
			configFormat: "typescript",
			primaryEnvironment: "production",
			stateFilePath: REAL_FIXTURE,
		});

		assert(result.success);

		const productionState = result.data.statesByEnvironment["production"];
		assert(productionState !== undefined);

		const [universe] = productionState.resources;
		assert(universe?.kind === "universe");

		expect(universe.outputs.rootPlaceId).toBe("17834656300");
	});

	it("should round-trip the migrated places block through selectEnvironment per environment", async () => {
		expect.assertions(4);

		const result = await migrateMantleState({
			configFormat: "typescript",
			primaryEnvironment: "production",
			stateFilePath: REAL_FIXTURE,
		});

		assert(result.success);

		const production = selectEnvironment(result.data.config, "production");
		assert(production.success);

		const development = selectEnvironment(result.data.config, "development");
		assert(development.success);

		expect(production.data.places?.["start"]?.placeId).toBe("17834656300");
		expect(production.data.places?.["start"]?.filePath).toBe("place.rbxlx");
		expect(development.data.places?.["start"]?.placeId).toBe("17613681043");
		expect(development.data.places?.["start"]?.filePath).toBe("place.rbxl");
	});

	it("should emit one place ResourceCurrentState per environment from the real fixture", async () => {
		expect.assertions(4);

		const result = await migrateMantleState({
			configFormat: "typescript",
			primaryEnvironment: "production",
			stateFilePath: REAL_FIXTURE,
		});

		assert(result.success);

		const { development, production } = result.data.statesByEnvironment;
		assert(development !== undefined && production !== undefined);

		const developmentPlace = development.resources.find(
			(resource) => resource.kind === "place",
		);
		const productionPlace = production.resources.find((resource) => resource.kind === "place");
		assert(developmentPlace?.kind === "place" && productionPlace?.kind === "place");

		expect(developmentPlace.placeId).toBe("17613681043");
		expect(developmentPlace.outputs.versionNumber).toBe(53);
		expect(productionPlace.placeId).toBe("17834656300");
		expect(productionPlace.outputs.versionNumber).toBe(12);
	});

	it("should recompute the icon hash from disk for an on-sale pass", async () => {
		expect.assertions(3);

		const result = await migrateMantleState({
			configFormat: "typescript",
			primaryEnvironment: "production",
			stateFilePath: REAL_FIXTURE,
		});

		assert(result.success);

		const productionState = result.data.statesByEnvironment["production"];
		assert(productionState !== undefined);

		const onSale = productionState.resources.find(
			(resource) => resource.kind === "gamePass" && resource.key === "1-example",
		);
		assert(onSale?.kind === "gamePass");

		expect(onSale.iconFileHashes).toStrictEqual({ "en-us": ICON_FILE_SHA256 });
		expect(onSale.outputs.assetId).toBe("838516503");
		expect(onSale.price).toBe(5);
	});

	it("should emit a blocked warning per experienceIcon resource and leave universe icon fields absent", async () => {
		expect.assertions(3);

		const result = await migrateMantleState({
			configFormat: "typescript",
			primaryEnvironment: "production",
			stateFilePath: REAL_FIXTURE,
		});

		assert(result.success);

		const productionState = result.data.statesByEnvironment["production"];
		assert(productionState !== undefined);

		const [universe] = productionState.resources;
		assert(universe?.kind === "universe");

		expect("icon" in universe).toBeFalse();
		expect("iconFileHashes" in universe).toBeFalse();
		expect(
			result.data.warnings.some((warning) => {
				return (
					warning.kind === "blocked" &&
					warning.mantlePath === "production.experienceIcon_singleton"
				);
			}),
		).toBeTrue();
	});

	it("should round-trip the universe overlay through selectEnvironment per environment", async () => {
		expect.assertions(2);

		const result = await migrateMantleState({
			configFormat: "typescript",
			primaryEnvironment: "production",
			stateFilePath: REAL_FIXTURE,
		});

		assert(result.success);

		const production = selectEnvironment(result.data.config, "production");
		const development = selectEnvironment(result.data.config, "development");
		assert(production.success);
		assert(development.success);

		expect(production.data.universe?.universeId).toBe("6110424408");
		expect(development.data.universe?.universeId).toBe("6031475575");
	});

	it("should set environment.label on environments mantle stamped with bracketed display-name prefixes", async () => {
		expect.assertions(2);

		const result = await migrateMantleState({
			configFormat: "typescript",
			primaryEnvironment: "production",
			stateFilePath: REAL_FIXTURE,
		});

		assert(result.success);

		expect(result.data.config.environments["development"]?.label).toBe("development");
		expect(result.data.config.environments["production"]?.label).toBeUndefined();
	});

	it("should reapply the environment-label prefix to displayName via selectEnvironment after migration", async () => {
		expect.assertions(2);

		const result = await migrateMantleState({
			configFormat: "typescript",
			primaryEnvironment: "production",
			stateFilePath: REAL_FIXTURE,
		});

		assert(result.success);

		const production = selectEnvironment(result.data.config, "production");
		const development = selectEnvironment(result.data.config, "development");
		assert(production.success);
		assert(development.success);

		expect(production.data.universe?.displayName).toBe("roblox-ts Project Template");
		expect(development.data.universe?.displayName).toBe(
			"[DEVELOPMENT] roblox-ts Project Template",
		);
	});

	it("should round-trip a per-environment universe overlay through loadConfig", async () => {
		expect.assertions(2);

		const result = await migrateMantleState({
			configFormat: "typescript",
			primaryEnvironment: "production",
			stateFilePath: REAL_FIXTURE,
		});

		assert(result.success);

		await withTemporaryDirectory(async (directory) => {
			writeFileSync(join(directory, "bedrock.config.ts"), result.data.configFileContent);
			const loaded = await loadConfig({ cwd: directory });

			assert(loaded.success);

			const development = selectEnvironment(loaded.data, "development");
			assert(development.success);

			expect(loaded.data.environments["development"]?.universe?.universeId).toBe(
				"6031475575",
			);
			expect(development.data.universe?.universeId).toBe("6031475575");
		});
	});

	it("should emit a resource-missing-from-env warning for a pass present only in one environment", async () => {
		expect.assertions(1);

		const result = await migrateMantleState({
			configFormat: "typescript",
			primaryEnvironment: "production",
			stateFilePath: REAL_FIXTURE,
		});

		assert(result.success);

		expect(result.data.warnings).toContainEqual({
			bedrockPath: "environments.development.passes.2-missing",
			kind: "interpretive",
			mantlePath: "development.pass_2-missing",
			rule: "factorize-environments/resource-missing-from-env",
		});
	});

	it("should round-trip a per-environment pass-field overlay through loadConfig and selectEnvironment", async () => {
		expect.assertions(3);

		const result = await migrateMantleState({
			configFormat: "typescript",
			primaryEnvironment: "production",
			readFile: async () => new TextEncoder().encode(TWO_ENV_DIVERGENT_PASS_YAML),
			stateFilePath: ".mantle-state.yml",
		});

		assert(result.success);

		await withTemporaryDirectory(async (directory) => {
			writeFileSync(join(directory, "bedrock.config.ts"), result.data.configFileContent);
			const loaded = await loadConfig({ cwd: directory });

			assert(loaded.success);

			const production = selectEnvironment(loaded.data, "production");
			const development = selectEnvironment(loaded.data, "development");
			assert(production.success);
			assert(development.success);

			expect(loaded.data.environments["development"]?.passes).toStrictEqual({
				vip: { price: 99 },
			});
			expect(production.data.passes?.["vip"]?.price).toBe(500);
			expect(development.data.passes?.["vip"]?.price).toBe(99);
		});
	});

	it("should round-trip a per-environment product price overlay through loadConfig and selectEnvironment", async () => {
		expect.assertions(3);

		const result = await migrateMantleState({
			configFormat: "typescript",
			primaryEnvironment: "production",
			readFile: async () => new TextEncoder().encode(TWO_ENV_DIVERGENT_PRODUCT_YAML),
			stateFilePath: ".mantle-state.yml",
		});

		assert(result.success);

		await withTemporaryDirectory(async (directory) => {
			writeFileSync(join(directory, "bedrock.config.ts"), result.data.configFileContent);
			const loaded = await loadConfig({ cwd: directory });

			assert(loaded.success);

			const production = selectEnvironment(loaded.data, "production");
			const development = selectEnvironment(loaded.data, "development");
			assert(production.success);
			assert(development.success);

			expect(production.data.products?.["gem-pack"]?.price).toBe(100);
			expect(development.data.products?.["gem-pack"]?.price).toBeUndefined();
			expect(loaded.data.products?.["gem-pack"]?.price).toBeUndefined();
		});
	});

	it("should migrate Mantle outputs.assetId (not outputs.productId) onto bedrock outputs.productId per environment", async () => {
		expect.assertions(2);

		// Mantle's outputs.assetId is the canonical marketplace product id and
		// is what Open Cloud's URL accepts; outputs.productId is a legacy config
		// id Open Cloud v2 does not route. Distinct fixture values per env prove
		// the right field flows through end-to-end and the right one is dropped.
		const result = await migrateMantleState({
			configFormat: "typescript",
			primaryEnvironment: "production",
			readFile: async () => new TextEncoder().encode(TWO_ENV_DIVERGENT_PRODUCT_YAML),
			stateFilePath: ".mantle-state.yml",
		});

		assert(result.success);

		const { development, production } = result.data.statesByEnvironment;
		const developmentProduct = development?.resources.find(
			(resource) => resource.kind === "developerProduct",
		);
		const productionProduct = production?.resources.find(
			(resource) => resource.kind === "developerProduct",
		);
		assert(developmentProduct?.kind === "developerProduct");
		assert(productionProduct?.kind === "developerProduct");

		expect(developmentProduct.outputs.productId).toBe("1000");
		expect(productionProduct.outputs.productId).toBe("3000");
	});

	it("should fall back to the Mantle hash and emit an ambiguous warning for a missing icon", async () => {
		expect.assertions(4);

		const result = await migrateMantleState({
			configFormat: "typescript",
			primaryEnvironment: "production",
			stateFilePath: REAL_FIXTURE,
		});

		assert(result.success);

		const productionState = result.data.statesByEnvironment["production"];
		assert(productionState !== undefined);

		const stub = productionState.resources.find(
			(resource) => resource.kind === "gamePass" && resource.key === "2-missing",
		);
		assert(stub?.kind === "gamePass");

		expect(stub.iconFileHashes).toStrictEqual({ "en-us": MANTLE_RECORDED_HASH });

		const ambiguous = result.data.warnings.filter(
			(warning) =>
				warning.kind === "ambiguous" && warning.mantlePath === "production.pass_2-missing",
		);
		assert(ambiguous[0]?.kind === "ambiguous");

		expect(ambiguous).toHaveLength(1);
		expect(ambiguous[0].hint).toContain("missing-icon.png");
		expect(result.data.summary.ambiguousCount).toBeGreaterThanOrEqual(1);
	});

	it("should fold every interpretive universe rule for the production primary while leaving universeId on per-environment overlays", async () => {
		expect.assertions(2);

		const result = await migrateMantleState({
			configFormat: "typescript",
			primaryEnvironment: "production",
			stateFilePath: REAL_FIXTURE,
		});

		assert(result.success);

		expect(result.data.config.universe).toStrictEqual({
			consoleEnabled: true,
			desktopEnabled: true,
			discordSocialLink: { title: "Join our Discord", uri: "https://discord.gg/example" },
			displayName: "roblox-ts Project Template",
			mobileEnabled: true,
			privateServerPriceRobux: 0,
			tabletEnabled: true,
			twitterSocialLink: {
				title: "Follow us on Twitter",
				uri: "https://twitter.com/example",
			},
			voiceChatEnabled: true,
		});
		expect(result.data.config.environments["production"]?.universe).toStrictEqual({
			universeId: "6110424408",
		});
	});

	it("should fold the development primary into a separate universe shape while leaving universeId on per-environment overlays", async () => {
		expect.assertions(2);

		const result = await migrateMantleState({
			configFormat: "typescript",
			primaryEnvironment: "development",
			stateFilePath: REAL_FIXTURE,
		});

		assert(result.success);

		expect(result.data.config.universe).toStrictEqual({
			consoleEnabled: true,
			desktopEnabled: true,
			discordSocialLink: { title: "Join our Discord", uri: "https://discord.gg/example" },
			displayName: "roblox-ts Project Template",
			mobileEnabled: true,
			privateServerPriceRobux: 0,
			tabletEnabled: true,
			voiceChatEnabled: true,
		});
		expect(result.data.config.environments["development"]?.universe).toStrictEqual({
			universeId: "6031475575",
		});
	});

	it("should emit a blocked warning rooted at every environment's experienceActivation_singleton.isActive", async () => {
		expect.assertions(2);

		const result = await migrateMantleState({
			configFormat: "typescript",
			primaryEnvironment: "production",
			stateFilePath: REAL_FIXTURE,
		});

		assert(result.success);

		const isActiveBlocked = result.data.warnings.filter((warning) => {
			return (
				warning.kind === "blocked" &&
				warning.mantlePath.endsWith(".experienceActivation_singleton.isActive")
			);
		});

		expect(isActiveBlocked.map((warning) => warning.mantlePath)).toIncludeAllMembers([
			"development.experienceActivation_singleton.isActive",
			"production.experienceActivation_singleton.isActive",
		]);
		expect(result.data.summary.blockedCount).toBeGreaterThanOrEqual(2);
	});

	it("should report interpretive warnings for every universe fold rule applied", async () => {
		expect.assertions(2);

		const result = await migrateMantleState({
			configFormat: "typescript",
			primaryEnvironment: "production",
			stateFilePath: REAL_FIXTURE,
		});

		assert(result.success);

		const interpretiveRules = result.data.warnings
			.filter((warning) => warning.kind === "interpretive")
			.map((warning) => warning.rule);

		expect(interpretiveRules).toIncludeAllMembers([
			"domain-to-field",
			"list-to-flag",
			"private-servers-priced",
			"start-place-name-to-display-name",
			"voice-chat-enabled",
		]);

		expect(result.data.summary.interpretiveCount).toBeGreaterThan(0);
	});

	it("should emit one blocked warning per legacy field per environment in the real fixture", async () => {
		expect.assertions(3);

		const result = await migrateMantleState({
			configFormat: "typescript",
			primaryEnvironment: "production",
			stateFilePath: REAL_FIXTURE,
		});

		assert(result.success);

		const blocked = result.data.warnings.filter((warning) => warning.kind === "blocked");

		// 12 fields per environment × 2 environments + 1 isFriendsOnly only
		// in production (development uses the YAML null sentinel)
		// + 1 experienceIcon resource per environment (Open Cloud has no
		// route to set the source-language icon).
		// Excluded: price and customSocialSlotsCount (null sentinel);
		// experience.groupId (null in both environments).
		expect(blocked).toHaveLength(27);
		expect(result.data.summary.blockedCount).toBe(27);

		const paths = blocked.map((warning) => warning.mantlePath);

		expect(paths).toIncludeAllMembers([
			"development.experienceConfiguration_singleton.genre",
			"development.experienceIcon_singleton",
			"production.experienceConfiguration_singleton.genre",
			"production.experienceConfiguration_singleton.universeAvatarType",
			"production.experienceIcon_singleton",
			"production.placeConfiguration_start.allowCopying",
		]);
	});

	it("should root every blocked warning's mantlePath at an environment name", async () => {
		expect.assertions(2);

		const result = await migrateMantleState({
			configFormat: "typescript",
			primaryEnvironment: "production",
			stateFilePath: REAL_FIXTURE,
		});

		assert(result.success);

		const paths = result.data.warnings
			.filter((warning) => warning.kind === "blocked")
			.map((warning) => warning.mantlePath);
		const missingPrefix = paths.filter(
			(path) => !path.startsWith("development.") && !path.startsWith("production."),
		);

		expect(missingPrefix).toStrictEqual([]);
		expect(paths.length).toBeGreaterThan(0);
	});

	it("should suppress blocked emission for fields set to the YAML null sentinel", async () => {
		expect.assertions(2);

		const result = await migrateMantleState({
			configFormat: "typescript",
			primaryEnvironment: "production",
			stateFilePath: REAL_FIXTURE,
		});

		assert(result.success);

		const paths = result.data.warnings
			.filter((warning) => warning.kind === "blocked")
			.map((warning) => warning.mantlePath);

		// customSocialSlotsCount and price use the YAML null sentinel (~) so
		// parseState strips them to undefined before the fold runs.
		expect(paths.filter((path) => path.endsWith(".customSocialSlotsCount"))).toStrictEqual([]);

		// experience.groupId is also null in both environments.
		expect(paths.filter((path) => path.endsWith(".groupId"))).toStrictEqual([]);
	});
});
