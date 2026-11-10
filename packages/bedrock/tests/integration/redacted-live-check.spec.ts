import {
	asRobloxAssetId,
	createGamePassDriver,
	defineConfig,
	deploy,
	type DriverRegistry,
	type ProgressEvent,
} from "@bedrock-rbx/core";
import { OpenCloudError } from "@bedrock-rbx/ocale";
import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validGamePassBody,
} from "@bedrock-rbx/ocale/testing";

import { assert, describe, it } from "vitest";

import { previewDiffAsync } from "#src/shell/preview-diff";
import { fakeStateStore } from "#tests/helpers/state-store";

const PLACEHOLDER = { name: "Coming soon", description: "Available later.", price: 7 };
const REAL_DISPLAY = { name: "VIP Pass", description: "Unlock VIP perks.", price: 500 };
const CONFIG = defineConfig({
	environments: { production: { redacted: PLACEHOLDER } },
	passes: { "vip-pass": { ...REAL_DISPLAY, icon: { "en-us": "assets/private.png" } } },
});

async function noFilesAsync(): Promise<Uint8Array> {
	throw new Error("Redaction must not read the private icon");
}

const UNUSED_DRIVER = {
	create() {
		throw new Error("Unexpected resource create");
	},
	retire() {
		throw new Error("Unexpected resource retirement");
	},
};

function registry(httpClient: FakeHttpClient): DriverRegistry {
	return {
		badge: UNUSED_DRIVER,
		developerProduct: UNUSED_DRIVER,
		gamePass: createGamePassDriver({
			client: new GamePassesClient({
				credential: { apiKey: "fake", kind: "apiKey" },
				httpClient,
				sleep: async () => {},
			}),
			readFile: noFilesAsync,
			universeId: asRobloxAssetId("123"),
		}),
		place: UNUSED_DRIVER,
		universe: UNUSED_DRIVER,
	};
}

function passBody(overrides: Parameters<typeof validGamePassBody>[0] = {}) {
	return validGamePassBody({
		name: PLACEHOLDER.name,
		description: PLACEHOLDER.description,
		gamePassId: 9_876_543_210,
		iconAssetId: 1_122_334_455,
		priceInformation: { defaultPriceInRobux: 7, enabledFeatures: [] },
		...overrides,
	});
}

async function redactedFixtureAsync() {
	const store = fakeStateStore();
	const seedHttp = createFakeHttpClient()
		.mockResponse({
			body: {
				gamePasses: [],
				// eslint-disable-next-line unicorn/no-null -- Roblox requires null on terminal list pages.
				nextPageToken: null,
			},
			status: 200,
		})
		.mockResponse({ body: passBody(), status: 200 });
	const seeded = await deploy({
		config: CONFIG,
		environment: "production",
		readFile: noFilesAsync,
		registry: registry(seedHttp),
		statePort: store.port,
	});
	assert(seeded.success);

	const httpClient = createFakeHttpClient();
	const events: Array<ProgressEvent> = [];
	return {
		events,
		httpClient,
		options: {
			config: CONFIG,
			environment: "production",
			progress: {
				emit: (event: ProgressEvent) => {
					events.push(event);
				},
			},
			readFile: noFilesAsync,
			registry: registry(httpClient),
			statePort: store.port,
		},
		seeded: seeded.data,
		store,
	};
}

describe("redacted Environment live check", () => {
	it("should refuse external placeholder edits during an audit without writing redacted State", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = await redactedFixtureAsync();
		fixture.httpClient.mockResponse({
			body: {
				gamePasses: [
					passBody({
						priceInformation: { defaultPriceInRobux: 500, enabledFeatures: [] },
					}),
				],
				// eslint-disable-next-line unicorn/no-null -- Roblox requires null on terminal list pages.
				nextPageToken: null,
			},
			status: 200,
		});
		const result = await deploy({ ...fixture.options, failOnOutOfBandEdit: true });

		expect(result).toMatchObject({
			err: {
				edits: [
					{
						key: "vip-pass",
						fields: [{ current: 7, field: "price", live: 500 }],
						kind: "gamePass",
					},
				],
				kind: "outOfBandEdits",
			},
			success: false,
		});
		expect(fixture.httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
			"GET",
		]);
		expect(fixture.store.states.get("production")).toStrictEqual(fixture.seeded);
		expect(fixture.store.writes).toHaveLength(1);
		expect(fixture.events.filter(({ kind }) => kind === "resourceOpStarted")).toStrictEqual([]);
	});

	it("should retain redacted State when the live placeholder read fails", async ({ expect }) => {
		expect.hasAssertions();

		const fixture = await redactedFixtureAsync();
		const cause = new OpenCloudError("placeholder read failed");
		fixture.httpClient.mockError(cause);
		const result = await deploy(fixture.options);

		expect(result).toStrictEqual({
			err: { cause, kind: "liveCheckFailed", resourceKind: "gamePass" },
			success: false,
		});
		expect(fixture.httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
			"GET",
		]);
		expect(fixture.store.states.get("production")).toStrictEqual(fixture.seeded);
		expect(fixture.store.writes).toHaveLength(1);
		expect(fixture.events.filter(({ kind }) => kind === "resourceOpStarted")).toStrictEqual([]);
	});

	it("should apply authored placeholder drift during an audit without a revert", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = await redactedFixtureAsync();
		fixture.httpClient
			.mockResponse({
				body: {
					gamePasses: [passBody()],
					// eslint-disable-next-line unicorn/no-null -- Roblox requires null on terminal list pages.
					nextPageToken: null,
				},
				status: 200,
			})
			.mockResponse({ status: 204 });
		const result = await deploy({
			...fixture.options,
			config: {
				...CONFIG,
				environments: { production: { redacted: { ...PLACEHOLDER, price: 9 } } },
			},
			failOnOutOfBandEdit: true,
		});
		assert(result.success);

		expect(result.data).toMatchObject({
			realDisplay: { "gamePass:vip-pass": REAL_DISPLAY },
			resources: [{ ...PLACEHOLDER, price: 9 }],
		});
		expect(fixture.store.states.get("production")).toStrictEqual(result.data);

		const { body } = fixture.httpClient.requests[1]!.request;
		assert(body instanceof FormData);

		expect({
			methods: fixture.httpClient.requests.map(({ request }) => request.method),
			price: body.get("price"),
		}).toStrictEqual({ methods: ["GET", "PATCH"], price: "9" });
		expect(fixture.events).not.toContainEqual(
			expect.objectContaining({ reason: "outOfBandEdit" }),
		);
		expect(fixture.events.find(({ kind }) => kind === "applySummary")).not.toHaveProperty(
			"reverted",
		);
	});

	it.for([
		{ label: "unchanged config", price: 7 },
		{ label: "an authored placeholder price change", price: 9 },
	])(
		"should restore external placeholder edits with $label and settle the next deploy",
		async ({ price }, { expect }) => {
			expect.hasAssertions();

			const fixture = await redactedFixtureAsync();
			fixture.httpClient
				.mockResponse({
					body: {
						gamePasses: [
							passBody({
								name: "VIP Pass",
								description: "Unlock VIP perks.",
								priceInformation: { defaultPriceInRobux: 500, enabledFeatures: [] },
							}),
						],
						// eslint-disable-next-line unicorn/no-null -- Roblox requires null on terminal list pages.
						nextPageToken: null,
					},
					status: 200,
				})
				.mockResponse({ status: 204 })
				.mockResponse({
					body: {
						gamePasses: [
							passBody({
								priceInformation: {
									defaultPriceInRobux: price,
									enabledFeatures: [],
								},
							}),
						],
						// eslint-disable-next-line unicorn/no-null -- Roblox requires null on terminal list pages.
						nextPageToken: null,
					},
					status: 200,
				});
			const options = {
				...fixture.options,
				config: {
					...CONFIG,
					environments: { production: { redacted: { ...PLACEHOLDER, price } } },
				},
			};
			const restored = await deploy(options);
			assert(restored.success);

			expect(restored.data).toMatchObject({
				realDisplay: { "gamePass:vip-pass": REAL_DISPLAY },
				resources: [{ ...PLACEHOLDER, outputs: { assetId: "9876543210" }, price }],
			});
			expect(fixture.store.states.get("production")).toStrictEqual(restored.data);

			const { body } = fixture.httpClient.requests[1]!.request;
			assert(body instanceof FormData);

			expect([
				body.get("name"),
				body.get("description"),
				body.get("price"),
				body.get("isForSale"),
				body.get("isManagedPricingEnabled"),
			]).toStrictEqual(["Coming soon", "Available later.", String(price), "true", "false"]);
			expect(
				fixture.events.filter(({ kind }) => {
					return [
						"applySummary",
						"liveCheck",
						"resourceOpStarted",
						"resourceOpSucceeded",
					].includes(kind);
				}),
			).toMatchObject([
				{
					check: {
						edits: [
							{
								key: "vip-pass",
								fields: [
									{
										current: "Available later.",
										field: "description",
										live: "Unlock VIP perks.",
									},
									{ current: "Coming soon", field: "name", live: "VIP Pass" },
									{ current: 7, field: "price", live: 500 },
								],
								kind: "gamePass",
							},
						],
					},
					kind: "liveCheck",
				},
				{ kind: "resourceOpStarted", opType: "update", reason: "outOfBandEdit" },
				{
					changedFields: ["description", "name", "price"],
					kind: "resourceOpSucceeded",
					opType: "update",
					reason: "outOfBandEdit",
				},
				{ kind: "applySummary", reverted: 1, updated: 1 },
			]);

			const reportedEvents = fixture.events.length;
			const settled = await deploy(options);
			assert(settled.success);
			const settledEvents = fixture.events.slice(reportedEvents);
			const report = settledEvents.find(({ kind }) => kind === "liveCheck");
			const summary = settledEvents.find(({ kind }) => kind === "applySummary");
			assert(report!.kind === "liveCheck" && summary!.kind === "applySummary");

			expect({
				edits: report.check.edits,
				methods: fixture.httpClient.requests.map(({ request }) => request.method),
				noop: summary.noop,
				persisted: fixture.store.states.get("production"),
				returned: settled.data,
				reverted: summary.reverted,
				started: settledEvents.filter(({ kind }) => kind === "resourceOpStarted"),
				updated: summary.updated,
			}).toStrictEqual({
				edits: [],
				methods: ["GET", "PATCH", "GET"],
				noop: 1,
				persisted: restored.data,
				returned: restored.data,
				reverted: undefined,
				started: [],
				updated: 0,
			});
		},
	);

	it("should deploy unchanged placeholders without an upstream write or revert", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = await redactedFixtureAsync();
		fixture.httpClient.mockResponse({
			body: {
				gamePasses: [passBody()],
				// eslint-disable-next-line unicorn/no-null -- Roblox requires null on terminal list pages.
				nextPageToken: null,
			},
			status: 200,
		});
		const result = await deploy(fixture.options);
		assert(result.success);

		expect(result.data).toStrictEqual(fixture.seeded);
		expect(fixture.store.states.get("production")).toStrictEqual(fixture.seeded);
		expect(fixture.httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
			"GET",
		]);
		expect(
			fixture.events.filter(({ kind }) => {
				return ["applySummary", "liveCheck", "resourceOpNoop"].includes(kind);
			}),
		).toMatchObject([
			{
				check: { checkedKinds: ["gamePass"], edits: [], missing: [] },
				kind: "liveCheck",
			},
			{
				key: "vip-pass",
				environment: "production",
				kind: "resourceOpNoop",
				resourceKind: "gamePass",
			},
			{ kind: "applySummary", noop: 1, updated: 0 },
		]);
		expect(fixture.events.find(({ kind }) => kind === "applySummary")).not.toHaveProperty(
			"reverted",
		);
	});

	it("should leave configured placeholders unchanged despite real display values in State", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = await redactedFixtureAsync();
		fixture.httpClient.mockResponse({
			body: {
				gamePasses: [passBody()],
				// eslint-disable-next-line unicorn/no-null -- Roblox requires null on terminal list pages.
				nextPageToken: null,
			},
			status: 200,
		});
		const preview = await previewDiffAsync(fixture.options);
		assert(preview.success);

		expect(fixture.seeded).toMatchObject({
			realDisplay: { "gamePass:vip-pass": REAL_DISPLAY },
			resources: [PLACEHOLDER],
		});
		expect(preview.data).toMatchObject({
			drift: [{ key: "vip-pass", kind: "gamePass", type: "noop" }],
			liveCheck: { checkedKinds: ["gamePass"], edits: [], missing: [] },
			ops: [{ key: "vip-pass", kind: "gamePass", type: "noop" }],
		});
		expect(fixture.httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
			"GET",
		]);
		expect(fixture.store.writes).toHaveLength(1);
		expect(fixture.store.states.get("production")).toStrictEqual(fixture.seeded);
	});

	it("should report a configured placeholder change as ordinary drift without an external edit", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = await redactedFixtureAsync();
		fixture.httpClient.mockResponse({
			body: {
				gamePasses: [passBody()],
				// eslint-disable-next-line unicorn/no-null -- Roblox requires null on terminal list pages.
				nextPageToken: null,
			},
			status: 200,
		});
		const preview = await previewDiffAsync({
			...fixture.options,
			config: {
				...CONFIG,
				environments: { production: { redacted: { ...PLACEHOLDER, price: 9 } } },
			},
		});
		assert(preview.success);

		expect(preview.data.liveCheck).toMatchObject({ edits: [], missing: [] });
		expect(preview.data.drift).toMatchObject([
			{
				changedFields: ["price"],
				current: { price: 7 },
				desired: { price: 9 },
				type: "update",
			},
		]);
		expect(preview.data.ops).toMatchObject([
			{
				changedFields: ["price"],
				current: { price: 7 },
				desired: { price: 9 },
				type: "update",
			},
		]);
		expect(preview.data.ops[0]).not.toHaveProperty("reason");
		expect({
			methods: fixture.httpClient.requests.map(({ request }) => request.method),
			writes: fixture.store.writes.length,
		}).toStrictEqual({ methods: ["GET"], writes: 1 });
	});

	it("should restore edited placeholders while preserving a separate config change in the preview", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = await redactedFixtureAsync();
		fixture.httpClient.mockResponse({
			body: {
				gamePasses: [
					passBody({
						name: "VIP Pass",
						description: "Unlock VIP perks.",
						priceInformation: {
							defaultPriceInRobux: 500,
							enabledFeatures: [],
						},
					}),
				],
				// eslint-disable-next-line unicorn/no-null -- Roblox requires null on terminal list pages.
				nextPageToken: null,
			},
			status: 200,
		});
		const preview = await previewDiffAsync({
			...fixture.options,
			config: {
				...CONFIG,
				passes: {
					"vip-pass": {
						...REAL_DISPLAY,
						icon: { "en-us": "assets/private.png" },
						isManagedPricingEnabled: true,
					},
				},
			},
		});
		assert(preview.success);

		expect(preview.data.liveCheck!.edits).toStrictEqual([
			{
				key: "vip-pass",
				fields: [
					{
						current: "Available later.",
						field: "description",
						live: "Unlock VIP perks.",
					},
					{ current: "Coming soon", field: "name", live: "VIP Pass" },
					{ current: 7, field: "price", live: 500 },
				],
				kind: "gamePass",
			},
		]);
		expect(preview.data.drift).toMatchObject([
			{ changedFields: ["isManagedPricingEnabled"], type: "update" },
		]);
		expect(preview.data.ops).toMatchObject([
			{
				changedFields: ["description", "name", "isManagedPricingEnabled", "price"],
				current: { ...REAL_DISPLAY, isManagedPricingEnabled: false },
				desired: { ...PLACEHOLDER, isManagedPricingEnabled: true },
				reason: "outOfBandEdit",
				type: "update",
			},
		]);
		expect(fixture.httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
			"GET",
		]);
		expect(fixture.store.writes).toHaveLength(1);
	});
});
