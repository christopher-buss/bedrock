import { loadConfig, migrateMantleState } from "@bedrock/core";

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it } from "vitest";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const REAL_FIXTURE = join(FIXTURES_ROOT, "roblox-ts-example.mantle-state.yml");

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
			outputFormat: "typescript",
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

	it("should produce one BedrockState per Mantle environment with the universe resource folded", async () => {
		expect.assertions(3);

		const result = await migrateMantleState({
			outputFormat: "typescript",
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
			outputFormat: "typescript",
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
});
