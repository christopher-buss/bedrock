import { loadConfig, migrateMantleState, selectEnvironment } from "@bedrock/core";

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it } from "vitest";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const REAL_FIXTURE = join(FIXTURES_ROOT, "roblox-ts-example.mantle-state.yml");
const ICON_FILE_SHA256 = "c2d4b446a44ce54fab8e01150e24dd24f3d850c7c14dcfe31f6321341dd86874";
const MANTLE_RECORDED_HASH = "86890ed405cabad0fcdabf52225d528981790fa551e915c070348761c28373c1";

async function withTemporaryDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
	const directory = mkdtempSync(join(tmpdir(), "bedrock-migrate-"));
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
			expect(loaded.data.universe?.universeId).toBe("6110424408");
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
			expect(loaded.data.universe?.universeId).toBe("6110424408");
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

		expect(onSale.iconFileHash).toBe(ICON_FILE_SHA256);
		expect(onSale.outputs.assetId).toBe("838516503");
		expect(onSale.price).toBe(5);
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

		expect(stub.iconFileHash).toBe(MANTLE_RECORDED_HASH);

		const ambiguous = result.data.warnings.filter(
			(warning) =>
				warning.kind === "ambiguous" && warning.mantlePath === "production.pass_2-missing",
		);
		assert(ambiguous[0]?.kind === "ambiguous");

		expect(ambiguous).toHaveLength(1);
		expect(ambiguous[0].hint).toContain("missing-icon.png");
		expect(result.data.summary.ambiguousCount).toBeGreaterThanOrEqual(1);
	});
});
