import {
	applyOps,
	asResourceKey,
	asRobloxAssetId,
	asSha256Hex,
	buildDesired,
	createGamePassDriver,
	diff,
	type DriverRegistry,
	flattenConfig,
	loadConfig,
	type Operation,
	type ResourceCurrentState,
	type ResourceDriver,
} from "@bedrock/core";
import { GamePassesClient } from "@bedrock/ocale/game-passes";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validGamePassBody,
} from "@bedrock/ocale/testing";

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it } from "vitest";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const TYPESCRIPT_FIXTURE_DIR = join(FIXTURES_ROOT, "typescript");
const ICON_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const UNIVERSE_ID = asRobloxAssetId("1234567890");
const VIP_PASS_KEY = "vip-pass";

const HAS_LUTE = (() => {
	if ((process.env["BEDROCK_LUTE_PATH"] ?? "").length > 0) {
		return true;
	}

	const lookup = process.platform === "win32" ? "where" : "which";
	return spawnSync(lookup, ["lute"]).status === 0;
})();

const SUPPORTED_FORMATS = (
	HAS_LUTE
		? (["typescript", "yaml", "json", "javascript", "luau"] as const)
		: (["typescript", "yaml", "json", "javascript"] as const)
) satisfies ReadonlyArray<string>;

interface CreateFlowResult {
	readonly applyOutcome: Awaited<ReturnType<typeof applyOps>>;
	readonly httpClient: FakeHttpClient;
	readonly opTypes: ReadonlyArray<Operation["type"]>;
}

async function readIcon(): Promise<Uint8Array> {
	return ICON_BYTES;
}

async function sha256HexOf(bytes: Uint8Array): Promise<string> {
	const buffer = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
	return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

const PLACE_STUB: ResourceDriver<"place"> = {
	async create() {
		throw new Error("PlaceDriver.create must not run for game-pass fixtures");
	},
};

const UNIVERSE_STUB: ResourceDriver<"universe"> = {
	async create() {
		throw new Error("UniverseDriver.create must not run for game-pass fixtures");
	},
};

function makeLiveRegistry(httpClient: FakeHttpClient): DriverRegistry {
	return {
		gamePass: createGamePassDriver({
			client: new GamePassesClient({
				apiKey: "test-key",
				httpClient,
				sleep: async () => {},
			}),
			readFile: readIcon,
			universeId: UNIVERSE_ID,
		}),
		place: PLACE_STUB,
		universe: UNIVERSE_STUB,
	};
}

async function buildExistingPass(
	overrides: Partial<ResourceCurrentState<"gamePass">> = {},
): Promise<ResourceCurrentState<"gamePass">> {
	return {
		key: asResourceKey(VIP_PASS_KEY),
		name: "VIP Pass",
		description: "Grants VIP perks.",
		iconFileHash: asSha256Hex(await sha256HexOf(ICON_BYTES)),
		iconFilePath: "assets/vip-icon.png",
		kind: "gamePass",
		outputs: {
			assetId: asRobloxAssetId("9876543210"),
			iconAssetId: asRobloxAssetId("1122334455"),
		},
		price: 500,
		...overrides,
	};
}

async function runPipelineFromFixture(cwd: string): Promise<CreateFlowResult> {
	const loaded = await loadConfig({ cwd });
	assert(loaded.success);

	const desiredResult = await buildDesired(flattenConfig(loaded.data), readIcon);
	assert(desiredResult.success);

	const httpClient = createFakeHttpClient().mockResponse({
		body: validGamePassBody(),
		status: 200,
	});
	const registry = makeLiveRegistry(httpClient);

	const ops = diff(desiredResult.data, []);
	const applyOutcome = await applyOps(ops, registry);

	return {
		applyOutcome,
		httpClient,
		opTypes: ops.map((op) => op.type),
	};
}

describe("config pipeline end-to-end", () => {
	it.for(SUPPORTED_FORMATS)(
		"should load a %s config, flatten it, and dispatch a create op for the declared game pass",
		async (format) => {
			expect.assertions(4);

			const { applyOutcome, httpClient, opTypes } = await runPipelineFromFixture(
				join(FIXTURES_ROOT, format),
			);

			expect(opTypes).toStrictEqual(["create"]);
			expect(applyOutcome.success).toBeTrue();

			const [first] = httpClient.requests;
			assert(first);

			expect(first.request.method).toBe("POST");
			expect(first.request.url).toBe(`/game-passes/v1/universes/${UNIVERSE_ID}/game-passes`);
		},
	);

	it("should load a function-form typescript config, flatten it, and dispatch a create op for the declared game pass", async () => {
		expect.assertions(2);

		const { applyOutcome, opTypes } = await runPipelineFromFixture(
			join(FIXTURES_ROOT, "typescript-function"),
		);

		expect(opTypes).toStrictEqual(["create"]);
		expect(applyOutcome.success).toBeTrue();
	});

	it("should forward every declared game-pass field into the multipart body, including the icon bytes", async () => {
		expect.assertions(4);

		const { httpClient } = await runPipelineFromFixture(TYPESCRIPT_FIXTURE_DIR);
		const [first] = httpClient.requests;
		assert(first);
		assert(first.request.body instanceof FormData);

		const imageFile = first.request.body.get("imageFile");
		assert(imageFile instanceof Blob);

		expect(first.request.body.get("name")).toBe("VIP Pass");
		expect(first.request.body.get("description")).toBe("Grants VIP perks.");
		expect(first.request.body.get("price")).toBe("500");
		expect(imageFile.size).toBe(ICON_BYTES.byteLength);
	});

	it("should emit a noop and skip driver dispatch when current state matches the fixture", async () => {
		expect.assertions(2);

		const loaded = await loadConfig({ cwd: TYPESCRIPT_FIXTURE_DIR });
		assert(loaded.success);

		const desiredResult = await buildDesired(flattenConfig(loaded.data), readIcon);
		assert(desiredResult.success);

		const ops = diff(desiredResult.data, [await buildExistingPass()]);

		expect(ops.map((op) => op.type)).toStrictEqual(["noop"]);

		const trapRegistry: DriverRegistry = {
			gamePass: {
				create() {
					throw new Error("GamePassDriver.create must not run for noop ops");
				},
			},
			place: PLACE_STUB,
			universe: UNIVERSE_STUB,
		};

		const applyResult = await applyOps(ops, trapRegistry);

		expect(applyResult.success).toBeTrue();
	});
});
