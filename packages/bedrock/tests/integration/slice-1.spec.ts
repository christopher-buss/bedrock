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
	type ResourceCurrentState,
	type Slice1ConfigInput,
} from "bedrock";
import { assert, describe, expect, it } from "vitest";

const ICON_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const UNIVERSE_ID = asRobloxAssetId("1234567890");

const SLICE_1_CONFIG: Slice1ConfigInput = {
	gamePasses: [
		{
			key: "vip-pass",
			name: "VIP Pass",
			description: "Grants VIP perks.",
			iconFilePath: "assets/vip-icon.png",
			price: 500,
		},
	],
};

async function readIcon(): Promise<Uint8Array> {
	return ICON_BYTES;
}

async function sha256HexOf(bytes: Uint8Array): Promise<string> {
	const buffer = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
	return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

function makeRegistry(httpClient: FakeHttpClient): DriverRegistry {
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
		key: asResourceKey("vip-pass"),
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

async function runCreateFlow(): Promise<{
	readonly didApply: boolean;
	readonly httpClient: FakeHttpClient;
	readonly opTypes: ReadonlyArray<string>;
}> {
	const httpClient = createFakeHttpClient().mockResponse({
		body: validGamePassBody(),
		status: 200,
	});
	const registry = makeRegistry(httpClient);

	const desiredResult = await buildDesired(SLICE_1_CONFIG, readIcon);
	assert(desiredResult.success);

	const ops = diff(desiredResult.data, []);
	const applyResult = await applyOps(ops, registry);

	return {
		didApply: applyResult.success,
		httpClient,
		opTypes: ops.map((op) => op.type),
	};
}

describe("slice 1 end-to-end", () => {
	it("should dispatch a create op to the ocale client's POST endpoint for a new game pass", async () => {
		expect.assertions(4);

		const { didApply, httpClient, opTypes } = await runCreateFlow();

		expect(opTypes).toStrictEqual(["create"]);
		expect(didApply).toBeTrue();

		assert(httpClient.requests.length === 1);
		const { request } = httpClient.requests[0]!;

		expect(request.method).toBe("POST");
		expect(request.url).toBe(`/game-passes/v1/universes/${UNIVERSE_ID}/game-passes`);
	});

	it("should forward every declared game-pass field into the multipart body, including the icon bytes", async () => {
		expect.assertions(4);

		const { httpClient } = await runCreateFlow();
		const { request } = httpClient.requests[0]!;
		assert(request.body instanceof FormData);

		const imageFile = request.body.get("imageFile");
		assert(imageFile instanceof Blob);

		expect(request.body.get("name")).toBe("VIP Pass");
		expect(request.body.get("description")).toBe("Grants VIP perks.");
		expect(request.body.get("price")).toBe("500");
		expect(imageFile.size).toBe(ICON_BYTES.byteLength);
	});

	it("should emit a noop and skip http calls when current state matches desired", async () => {
		expect.assertions(3);

		const httpClient = createFakeHttpClient();
		const registry = makeRegistry(httpClient);

		const desiredResult = await buildDesired(SLICE_1_CONFIG, readIcon);
		assert(desiredResult.success);

		const ops = diff(desiredResult.data, [await buildExistingPass()]);

		expect(ops.map((op) => op.type)).toStrictEqual(["noop"]);

		const applyResult = await applyOps(ops, registry);

		expect(applyResult.success).toBeTrue();
		expect(httpClient.requests).toBeEmpty();
	});

	it("should reject drift with updateUnsupported and never hit the ocale client", async () => {
		expect.assertions(3);

		const httpClient = createFakeHttpClient();
		const registry = makeRegistry(httpClient);

		const desiredResult = await buildDesired(SLICE_1_CONFIG, readIcon);
		assert(desiredResult.success);

		const ops = diff(desiredResult.data, [await buildExistingPass({ price: 250 })]);

		expect(ops.map((op) => op.type)).toStrictEqual(["update"]);

		const applyResult = await applyOps(ops, registry);
		assert(!applyResult.success);

		expect(applyResult.err.kind).toBe("updateUnsupported");
		expect(httpClient.requests).toBeEmpty();
	});
});
