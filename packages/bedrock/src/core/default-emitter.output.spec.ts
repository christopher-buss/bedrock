import { HAS_LUTE } from "@bedrock-rbx/testing/lute";

import {
	developerProductCurrent,
	gamePassCurrent,
	placeCurrent,
	universeCurrent,
} from "#tests/helpers/resources";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { assert, describe, expect, it } from "vitest";

import { createLuteLuauEvaluator } from "../adapters/lute-luau-evaluator.ts";
import { asRobloxAssetId } from "../types/ids.ts";
import type { CodegenFile, EmitInput } from "./codegen.ts";
import { createDefaultEmitter } from "./default-emitter.ts";
import type { ResourceCurrentState } from "./resources.ts";
import type { BedrockState } from "./state.ts";

// Golden fixtures committed alongside the package so a reviewer can open the
// real generated artifacts; the snapshot tests below regenerate and diff them.
const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../tests/fixtures/codegen");

function stateOf(
	environment: string,
	resources: ReadonlyArray<ResourceCurrentState>,
): BedrockState {
	return { environment, resources, version: 1 };
}

/**
 * One input that exercises the full emitter surface: every resource kind, a
 * never-deployed (empty) environment, a second environment that omits an
 * optional output, nested locale maps, numeric-count outputs, and resource
 * keys that need Luau bracket-quoting (`vip-pass`) alongside a bare-identifier
 * key (`main`). The golden fixtures and the evaluation proof both derive from
 * it so the committed example and the runnable proof never drift.
 *
 * @returns The emit input covering every emitter branch.
 */
function comprehensiveInput(): EmitInput {
	return {
		environments: {
			development: stateOf("development", []),
			production: stateOf("production", [
				gamePassCurrent(),
				developerProductCurrent({
					outputs: {
						iconImageAssetId: asRobloxAssetId("5550001112"),
						productId: asRobloxAssetId("8172635495"),
					},
				}),
				placeCurrent({ outputs: { versionNumber: 7 } }),
				universeCurrent(),
			]),
			staging: stateOf("staging", [gamePassCurrent(), developerProductCurrent()]),
		},
	};
}

async function emitFile(input: EmitInput, path: string): Promise<string> {
	const files: ReadonlyArray<CodegenFile> = await createDefaultEmitter({
		typeDeclarations: true,
	})(input);
	return files.find((file) => file.path === path)!.content;
}

/**
 * Type-check `consumer.ts` against the generated `resources.d.ts` the way a
 * roblox-ts project would: under CommonJS resolution so `export =` /
 * `import = require` are first-class, rather than the package's own strict-ESM
 * config. Both files are written to a temp directory so the real module
 * resolver exercises the `./resources` import end-to-end.
 *
 * @param declaration - The generated `resources.d.ts` source to type the module.
 * @param consumer - A `consumer.ts` source that imports and reads the module.
 * @returns Flattened pre-emit diagnostic messages; empty when the consumer
 *   type-checks cleanly.
 */
function consumerDiagnostics(declaration: string, consumer: string): ReadonlyArray<string> {
	const directory = mkdtempSync(join(tmpdir(), "bedrock-emitter-dts-"));
	try {
		writeFileSync(join(directory, "resources.d.ts"), declaration);
		const consumerPath = join(directory, "consumer.ts");
		writeFileSync(consumerPath, consumer);

		// The temp dir has no package.json, so NodeNext treats the files as
		// CommonJS: exactly the `export =` / `import = require` world roblox-ts
		// consumers live in, without the deprecated `node10` resolver.
		const options: ts.CompilerOptions = {
			esModuleInterop: true,
			module: ts.ModuleKind.NodeNext,
			moduleResolution: ts.ModuleResolutionKind.NodeNext,
			noEmit: true,
			skipLibCheck: true,
			strict: true,
			target: ts.ScriptTarget.ESNext,
		};
		const program = ts.createProgram(
			[consumerPath],
			options,
			ts.createCompilerHost(options, true),
		);
		return ts
			.getPreEmitDiagnostics(program)
			.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
	} finally {
		rmSync(directory, { force: true, recursive: true });
	}
}

async function withTemporaryLuau<T>(
	content: string,
	run: (absolutePath: string) => Promise<T>,
): Promise<T> {
	const directory = mkdtempSync(join(tmpdir(), "bedrock-emitter-output-"));
	try {
		const absolutePath = join(directory, "resources.luau");
		writeFileSync(absolutePath, content);
		return await run(absolutePath);
	} finally {
		rmSync(directory, { force: true, recursive: true });
	}
}

describe("default emitter golden fixtures", () => {
	it("should match the committed resources.luau example", async () => {
		expect.assertions(1);

		const content = await emitFile(comprehensiveInput(), "resources.luau");

		await expect(content).toMatchFileSnapshot(join(FIXTURE_DIR, "resources.luau"));
	});

	it("should match the committed resources.d.ts example", async () => {
		expect.assertions(1);

		const content = await emitFile(comprehensiveInput(), "resources.d.ts");

		await expect(content).toMatchFileSnapshot(join(FIXTURE_DIR, "resources.d.ts"));
	});
});

describe("default emitter Luau output validity", () => {
	it.skipIf(!HAS_LUTE)(
		"should evaluate the generated Luau to a table of real numbers keyed by environment",
		async () => {
			expect.assertions(3);

			const content = await emitFile(comprehensiveInput(), "resources.luau");

			const result = await withTemporaryLuau(content, createLuteLuauEvaluator());

			assert(result.success);

			expect(result.data["production"]).toStrictEqual({
				"gem-pack": { iconImageAssetId: 5_550_001_112, productId: 8_172_635_495 },
				"main": { rootPlaceId: 4711 },
				"start-place": { versionNumber: 7 },
				"vip-pass": { assetId: 9_876_543_210, iconAssetIds: { "en-us": 1_122_334_455 } },
			});
			expect(result.data["staging"]).toStrictEqual({
				"gem-pack": { productId: 8_172_635_495 },
				"vip-pass": { assetId: 9_876_543_210, iconAssetIds: { "en-us": 1_122_334_455 } },
			});
			// Luau's empty table is ambiguous between an array and a map; the
			// `@std/json` encoder the evaluator uses serializes `{}` as a JSON
			// array, so a never-deployed environment round-trips to `[]`.
			expect(result.data["development"]).toStrictEqual([]);
		},
	);
});

describe("default emitter declaration validity", () => {
	it("should type-check against a roblox-ts-style require consumer", async () => {
		expect.assertions(1);

		const declaration = await emitFile(comprehensiveInput(), "resources.d.ts");

		const diagnostics = consumerDiagnostics(
			declaration,
			[
				'import resources = require("./resources");',
				"",
				'const assetId: number = resources.production["vip-pass"].assetId;',
				'const iconId: number = resources.production["vip-pass"].iconAssetIds["en-us"];',
				'const version: number = resources.production["start-place"].versionNumber;',
				"",
				"export { assetId, iconId, version };",
				"",
			].join("\n"),
		);

		expect(diagnostics).toStrictEqual([]);
	});

	it("should give a consumer real types that reject reading an asset ID as a string", async () => {
		expect.assertions(1);

		const declaration = await emitFile(comprehensiveInput(), "resources.d.ts");

		const diagnostics = consumerDiagnostics(
			declaration,
			[
				'import resources = require("./resources");',
				"",
				'const wrong: string = resources.production["vip-pass"].assetId;',
				"",
				"export { wrong };",
				"",
			].join("\n"),
		);

		expect(diagnostics).not.toStrictEqual([]);
	});
});
