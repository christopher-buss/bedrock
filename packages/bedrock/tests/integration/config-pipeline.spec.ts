import { GamePassesClient } from "@bedrock/ocale/game-passes";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validGamePassBody,
} from "@bedrock/ocale/testing";

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
} from "bedrock";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it } from "vitest";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const TYPESCRIPT_FIXTURE_DIR = join(FIXTURES_ROOT, "typescript");
const ICON_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const UNIVERSE_ID = asRobloxAssetId("1234567890");
const VIP_PASS_KEY = "vip-pass";

const SUPPORTED_FORMATS = ["typescript", "yaml", "json", "javascript"] as const;

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
	};
}

async function buildExistingPass(
	overrides: Partial<ResourceCurrentState> = {},
): Promise<ResourceCurrentState> {
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
		};

		const applyResult = await applyOps(ops, trapRegistry);

		expect(applyResult.success).toBeTrue();
	});
});
