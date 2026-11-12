import { asResourceKey, asRobloxAssetId, createGamePassDriver, deploy } from "@bedrock-rbx/core";
import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validGamePassBody,
} from "@bedrock-rbx/ocale/testing";

import { assert, describe, it } from "vitest";

import type { EnvironmentEntry } from "#src/core/schema";
import type { BedrockState } from "#src/core/state";
import type { ProgressEvent } from "#src/ports/progress-port";
import type { DriverRegistry } from "#src/ports/resource-driver";
import { previewDiffAsync } from "#src/shell/preview-diff";
import { gamePassCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

type PassOverlay = NonNullable<EnvironmentEntry["passes"]>[string];

const PASS_ID = "9876543210";
const LINE = `environments.production.passes.vip-pass.importId "${PASS_ID}"`;

function passBody() {
	return validGamePassBody({
		name: "VIP Pass",
		description: "Grants VIP perks.",
		gamePassId: Number(PASS_ID),
		iconAssetId: 1_122_334_455,
		priceInformation: { defaultPriceInRobux: 500, enabledFeatures: [] },
	});
}

function listBody() {
	// eslint-disable-next-line unicorn/no-null -- Terminal Roblox list page.
	return { gamePasses: [passBody()], nextPageToken: null };
}

const trap = {
	create() {
		throw new Error("Unexpected create");
	},
	retire() {
		throw new Error("Unexpected retire");
	},
};

function registryFor(http: FakeHttpClient): DriverRegistry {
	return {
		badge: trap,
		developerProduct: trap,
		gamePass: createGamePassDriver({
			client: new GamePassesClient({
				credential: { apiKey: "fake", kind: "apiKey" },
				httpClient: http,
				sleep: async () => {},
			}),
			readFile: async () => new Uint8Array(),
			universeId: asRobloxAssetId("123"),
		}),
		place: trap,
		universe: trap,
	};
}

function guardOptions({
	http,
	initial,
	live,
	overlay,
	passes = {},
}: {
	readonly http: FakeHttpClient;
	readonly initial?: Readonly<Record<string, BedrockState>>;
	readonly live?: boolean;
	readonly overlay?: PassOverlay;
	readonly passes?: Readonly<Record<string, { name: string }>>;
}) {
	const events: Array<ProgressEvent> = [];
	const store = fakeStateStore(initial === undefined ? {} : { initial });
	const pass = {
		description: "Grants VIP perks.",
		icon: { "en-us": "assets/vip-icon.png" },
		price: 500,
	};
	return {
		events,
		options: {
			config: {
				environments: {
					production: overlay === undefined ? {} : { passes: { "vip-pass": overlay } },
				},
				passes: {
					...Object.fromEntries(
						Object.entries(passes).map(([key, { name }]) => [key, { ...pass, name }]),
					),
					"vip-pass": { ...pass, name: "VIP Pass" },
				},
			},
			environment: "production",
			live,
			progress: {
				emit: (event: ProgressEvent) => {
					events.push(event);
				},
			},
			readFile: async () => new Uint8Array(),
			registry: registryFor(http),
			statePort: store.port,
		},
		store,
	};
}

describe("untracked name guard", () => {
	it("should fail a deploy before any Operation when an untracked live pass has the create's name", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient().mockResponse({ body: listBody(), status: 200 });
		const { options, store } = guardOptions({ http });
		const result = await deploy(options);

		assert(!result.success);
		assert(result.err.kind === "buildDesiredFailed");
		assert(result.err.cause.kind === "untrackedNameMatch");

		expect(result.err.cause.matches).toStrictEqual([
			{ key: "vip-pass", kind: "gamePass", robloxId: PASS_ID },
		]);
		expect(result.err.cause.message).toContain(LINE);
		expect(http.requests.map(({ request }) => request.method)).toStrictEqual(["GET"]);
		expect(store.writes).toBeEmpty();
	});

	it("should import the item on the next deploy once the printed line is added", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse({ body: passBody(), status: 200 })
			.mockResponse({ body: listBody(), status: 200 });
		const { events, options } = guardOptions({
			http,
			overlay: { iconBaseline: "accept-local-file", importId: PASS_ID },
		});
		const result = await deploy(options);

		assert(result.success, JSON.stringify(result));

		expect(events).toContainEqual(
			expect.objectContaining({ key: "vip-pass", kind: "resourceImported" }),
		);
	});

	it("should fail a diff when an untracked live pass has the create's name", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient().mockResponse({ body: listBody(), status: 200 });
		const { options } = guardOptions({ http });
		const result = await previewDiffAsync(options);

		assert(!result.success);
		assert(result.err.kind === "buildDesiredFailed");
		assert(result.err.cause.kind === "untrackedNameMatch");

		expect(result.err.cause.message).toContain(LINE);
	});

	it("should plan the create when another Key tracks the same-named live pass", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient().mockResponse({ body: listBody(), status: 200 });
		const { options } = guardOptions({
			http,
			initial: {
				production: {
					environment: "production",
					resources: [
						gamePassCurrent({
							key: asResourceKey("old-pass"),
							name: "VIP Pass",
							outputs: {
								assetId: asRobloxAssetId(PASS_ID),
								iconAssetIds: { "en-us": asRobloxAssetId("1122334455") },
							},
						}),
					],
					version: 1,
				},
			},
			passes: { "old-pass": { name: "VIP Pass" } },
		});
		const result = await previewDiffAsync(options);

		assert(result.success, JSON.stringify(result));

		expect(result.data.ops.map(({ key, type }) => `${type}:${key}`)).toContain(
			"create:vip-pass",
		);
	});

	it("should skip the guard when the live check is disabled", async ({ expect }) => {
		expect.hasAssertions();

		const http = createFakeHttpClient();
		const { options } = guardOptions({ http, live: false });
		const result = await previewDiffAsync(options);

		assert(result.success, JSON.stringify(result));

		expect(result.data.ops.map(({ key, type }) => `${type}:${key}`)).toStrictEqual([
			"create:vip-pass",
		]);
		expect(http.requests).toBeEmpty();
	});
});
