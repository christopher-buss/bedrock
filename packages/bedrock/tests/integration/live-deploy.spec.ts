import { deploy, provision, publish } from "@bedrock-rbx/core";
import { OpenCloudError } from "@bedrock-rbx/ocale";
import { createFakeHttpClient, validGamePassBody } from "@bedrock-rbx/ocale/testing";

import { assert, describe, it } from "vitest";

import { createClackProgressAdapter } from "#src/adapters/clack-progress-adapter";
import { previewDiffAsync } from "#src/shell/preview-diff";
import { readLiveStateAsync } from "#src/shell/read-live-state";
import { asResourceKey, asRobloxAssetId } from "#src/types/ids";
import { fakeClackPort } from "#tests/helpers/clack";
import { mutableFencedStateStore } from "#tests/helpers/concurrent-state-store";
import { environmentFrom } from "#tests/helpers/environment";
import { livePassFixture as fixture } from "#tests/helpers/live-game-pass";
import { developerProductCurrent, gamePassCurrent, placeCurrent } from "#tests/helpers/resources";
import { resultsInOrder } from "#tests/helpers/sequence";
import { fakeStateStore } from "#tests/helpers/state-store";

describe("live deploy", () => {
	it.for([deploy, provision, previewDiffAsync])(
		"should perform a required live check with supplied authenticated Drivers",
		async (run, { expect }) => {
			expect.hasAssertions();

			const subject = fixture(500);
			const result = await run({ ...subject.options, live: true });
			assert(result.success);

			expect(subject.httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
				"GET",
			]);
		},
	);

	it("should preview offline without constructing credentialed readers or requiring their universe config", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const subject = fixture();
		const { registry: _registry, ...options } = subject.options;
		const result = await previewDiffAsync({
			...options,
			credential: { apiKey: "fake", kind: "apiKey" },
			live: false,
		});
		assert(result.success);

		expect(result.data.ops).toStrictEqual([
			{ key: "vip-pass", kind: "gamePass", type: "noop" },
		]);
		expect(result.data.liveCheck!.checkedKinds).toStrictEqual([]);
		expect(subject.httpClient.requests).toBeEmpty();
	});

	it("should label a partial revert when config adopts another edited field", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient().mockResponse({
			body: {
				gamePasses: [
					validGamePassBody({
						name: "Edited VIP",
						description: "Grants VIP perks.",
						gamePassId: 9_876_543_210,
						priceInformation: { defaultPriceInRobux: 120, enabledFeatures: [] },
					}),
				],
				// eslint-disable-next-line unicorn/no-null -- Terminal Roblox list page.
				nextPageToken: null,
			},
			status: 200,
		});
		const subject = fixture(120, http);
		const result = await previewDiffAsync({
			...subject.options,
			config: {
				...subject.options.config,
				passes: {
					"vip-pass": {
						...subject.options.config.passes["vip-pass"],
						name: "Edited VIP",
					},
				},
			},
		});
		assert(result.success);

		expect(result.data.liveCheck!.edits).toMatchObject([
			{ fields: [{ field: "name" }, { field: "price" }] },
		]);
		expect(result.data.ops).toMatchObject([
			{ changedFields: ["price"], reason: "outOfBandEdit", type: "update" },
		]);
	});

	it("should annotate only the edited kind when different kinds share a key", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const subject = fixture();
		const product = developerProductCurrent({ key: subject.current.key, price: 500 });
		const store = fakeStateStore({
			initial: {
				production: {
					environment: "production",
					resources: [subject.current, product],
					version: 1,
				},
			},
		});
		const result = await previewDiffAsync({
			...subject.options,
			config: {
				...subject.options.config,
				products: {
					"vip-pass": {
						name: product.name,
						description: product.description,
						price: 600,
					},
				},
			},
			statePort: store.port,
		});
		assert(result.success);
		const updates = result.data.ops.filter((op) => op.type === "update");

		expect(updates.find(({ desired }) => desired.kind === "gamePass")).toMatchObject({
			reason: "outOfBandEdit",
		});
		expect(
			updates.find(({ desired }) => desired.kind === "developerProduct"),
		).not.toHaveProperty("reason");
	});

	it("should annotate only the edited key when another pass has ordinary price drift", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const current = gamePassCurrent();
		const other = gamePassCurrent({
			key: asResourceKey("other"),
			name: "Other",
			outputs: { ...current.outputs, assetId: asRobloxAssetId("2") },
		});
		const http = createFakeHttpClient().mockResponse({
			body: {
				gamePasses: [
					validGamePassBody({
						name: current.name,
						description: current.description,
						gamePassId: 9_876_543_210,
						priceInformation: { defaultPriceInRobux: 120, enabledFeatures: [] },
					}),
					validGamePassBody({
						name: other.name,
						description: other.description,
						gamePassId: 2,
						priceInformation: { defaultPriceInRobux: 500, enabledFeatures: [] },
					}),
				],
				// eslint-disable-next-line unicorn/no-null -- Terminal Roblox list page.
				nextPageToken: null,
			},
			status: 200,
		});
		const subject = fixture(120, http);
		const store = fakeStateStore({
			initial: {
				production: { environment: "production", resources: [current, other], version: 1 },
			},
		});
		const result = await previewDiffAsync({
			...subject.options,
			config: {
				...subject.options.config,
				passes: {
					...subject.options.config.passes,
					other: {
						name: other.name,
						description: other.description,
						icon: other.icon,
						price: 600,
					},
				},
			},
			statePort: store.port,
		});
		assert(result.success);

		expect(result.data.ops.find(({ key }) => key === "vip-pass")).toMatchObject({
			reason: "outOfBandEdit",
		});
		expect(result.data.ops.find(({ key }) => key === "other")).not.toHaveProperty("reason");
	});

	it("should keep an update ordinary when config adopts the edited live field", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const subject = fixture();
		const result = await previewDiffAsync({
			...subject.options,
			config: {
				...subject.options.config,
				passes: {
					"vip-pass": {
						...subject.options.config.passes["vip-pass"],
						description: "New description",
						price: 120,
					},
				},
			},
		});
		assert(result.success);

		expect(result.data.ops).toMatchObject([{ changedFields: ["description"], type: "update" }]);
		expect(result.data.ops[0]).not.toHaveProperty("reason");
		expect(result.data.liveCheck!.edits).toMatchObject([{ fields: [{ field: "price" }] }]);
	});

	it("should apply ordinary config drift without live reads or revert labels when disabled", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const subject = fixture(120, createFakeHttpClient().mockResponse({ status: 204 }));
		const result = await deploy({
			...subject.options,
			config: {
				...subject.options.config,
				passes: {
					"vip-pass": { ...subject.options.config.passes["vip-pass"], price: 120 },
				},
			},
			live: false,
		});
		assert(result.success);

		expect(subject.httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
			"PATCH",
		]);
		expect(subject.store.states.get("production")!.resources).toMatchObject([{ price: 120 }]);
		expect(
			subject.events.find(({ kind }) => kind === "resourceOpSucceeded"),
		).not.toHaveProperty("reason");
	});

	it("should keep restored fields and checkpoint versions through publish without repeating the live read", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const subject = fixture();
		const place = placeCurrent({ filePath: "lobby.rbxl" });
		const store = mutableFencedStateStore({
			environment: "production",
			resources: [subject.current, place],
			version: 1,
		});
		const result = await deploy({
			...subject.options,
			build: async () => {},
			codegenWriter: { write: async () => ({ data: undefined, success: true }) },
			config: {
				...subject.options.config,
				codegen: { enabled: true },
				environments: { production: { places: { "start-place": { placeId: "4711" } } } },
				places: { "start-place": { filePath: "lobby.rbxl" } },
			},
			emit: () => [],
			registry: {
				...subject.options.registry,
				place: {
					create: async () => ({ data: place, success: true }),
					retire: async () => ({ data: undefined, success: true }),
					update: async () => ({ data: place, success: true }),
				},
			},
			statePort: store.port,
		});
		assert(result.success, JSON.stringify(result));

		expect(result.data.resources).toMatchObject([
			{ kind: "gamePass", price: 500 },
			{ kind: "place" },
		]);
		expect(subject.httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
			"GET",
			"PATCH",
		]);
	});

	it("should retain compatibility with the reader's resource-array input", async ({ expect }) => {
		expect.hasAssertions();

		const subject = fixture();
		const result = await readLiveStateAsync(subject.options.registry, [subject.current]);
		assert(result.success);

		expect(result.data.resources).toMatchObject([{ price: 120 }]);
		expect(result.data.check.edits).toMatchObject([{ fields: [{ field: "price" }] }]);
	});

	it("should read no resources into a first deployment and keep untracked live passes out of State", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const subject = fixture();
		const store = fakeStateStore();
		const result = await deploy({
			...subject.options,
			config: { environments: { production: {} } },
			statePort: store.port,
		});
		assert(result.success);

		expect(result.data.resources).toStrictEqual([]);
		expect(subject.httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
			"GET",
		]);
	});

	it("should fail a live preflight State read before any request or write", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const subject = fixture();
		const cause = {
			file: "production.json",
			kind: "stateError",
			reason: "unavailable",
		} as const;
		const store = fakeStateStore({ refuseRead: { production: cause } });
		const result = await deploy({ ...subject.options, statePort: store.port });

		expect(result).toMatchObject({ err: { cause, kind: "stateReadFailed" }, success: false });
		expect(subject.httpClient.requests).toBeEmpty();
		expect(store.writes).toBeEmpty();
	});

	it("should honor a State read failure after the live check", async ({ expect }) => {
		expect.hasAssertions();

		const subject = fixture();
		const cause = {
			file: "production.json",
			kind: "stateError",
			reason: "unavailable",
		} as const;
		const result = await deploy({
			...subject.options,
			statePort: {
				...subject.store.port,
				read: resultsInOrder([
					{ data: { state: subject.store.states.get("production")! }, success: true },
					{ err: cause, success: false },
				]),
			},
		});

		expect(result).toMatchObject({ err: { cause, kind: "stateReadFailed" }, success: false });
		expect(subject.httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
			"GET",
		]);
		expect(subject.store.writes).toBeEmpty();
	});

	it("should report a failed reversion without counting it as a successful revert", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse({
				body: {
					gamePasses: [
						validGamePassBody({
							name: "VIP Pass",
							description: "Grants VIP perks.",
							gamePassId: 9_876_543_210,
							priceInformation: { defaultPriceInRobux: 120, enabledFeatures: [] },
						}),
					],
					// eslint-disable-next-line unicorn/no-null -- Terminal Roblox list page.
					nextPageToken: null,
				},
				status: 200,
			})
			.mockError(new OpenCloudError("write failed"));
		const subject = fixture(120, http);
		const result = await deploy(subject.options);

		expect(result).toMatchObject({ err: { kind: "applyFailed" }, success: false });
		expect(subject.events).toContainEqual(
			expect.objectContaining({ kind: "resourceOpFailed", reason: "outOfBandEdit" }),
		);
		expect(subject.events.find(({ kind }) => kind === "applySummary")).toMatchObject({
			failed: 1,
			updated: 0,
		});
		expect(subject.events.find(({ kind }) => kind === "applySummary")).not.toHaveProperty(
			"reverted",
		);
	});

	it("should return the restored snapshot when its State write fails", async ({ expect }) => {
		expect.hasAssertions();

		const subject = fixture();
		const cause = {
			file: "production.json",
			kind: "stateError",
			reason: "write failed",
		} as const;
		const store = fakeStateStore({
			initial: { production: subject.store.states.get("production")! },
			refuseWrite: { production: cause },
		});
		const result = await deploy({ ...subject.options, statePort: store.port });

		expect(result).toMatchObject({
			err: { kind: "stateWriteFailed", unsavedState: { resources: [{ price: 500 }] } },
			success: false,
		});
		expect(store.states.get("production")!.resources).toStrictEqual([subject.current]);
	});

	it("should preserve withheld place bookkeeping when a live baseline adopts its renamed key", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const subject = fixture();
		const place = placeCurrent();
		const store = fakeStateStore({
			initial: {
				production: {
					environment: "production",
					pendingRebuild: new Set([place.key]),
					realDisplay: {
						"place:start-place": {
							name: "Real Lobby",
							description: "Real description",
						},
					},
					resources: [subject.current, place],
					version: 1,
				},
			},
		});
		const result = await provision({
			...subject.options,
			config: {
				...subject.options.config,
				environments: { production: { places: { lobby: { placeId: "4711" } } } },
				places: { lobby: { filePath: "lobby.rbxl", movedFrom: "start-place" } },
			},
			statePort: store.port,
		});
		assert(result.success);

		expect(result.data.pendingRebuild).toStrictEqual(new Set([asResourceKey("lobby")]));
		expect(result.data.realDisplay).toStrictEqual({
			"place:lobby": { name: "Real Lobby", description: "Real description" },
		});
	});

	it.for([deploy, provision, publish, previewDiffAsync])(
		"should refuse an audit before any operation and list the edited fields",
		async (run, { expect }) => {
			expect.hasAssertions();

			const subject = fixture();
			const result = await run({ ...subject.options, failOnOutOfBandEdit: true });

			expect(result).toMatchObject({
				err: {
					edits: [
						{
							key: "vip-pass",
							fields: [{ current: 500, field: "price", live: 120 }],
							kind: "gamePass",
						},
					],
					kind: "outOfBandEdits",
				},
				success: false,
			});
			expect(subject.httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
				"GET",
			]);
			expect(subject.store.writes).toBeEmpty();
			expect(subject.events.filter(({ kind }) => kind === "resourceOpStarted")).toBeEmpty();
		},
	);

	it.for([deploy, provision, publish, previewDiffAsync])(
		"should require credentials when live checking is required",
		async (run, { expect }) => {
			expect.hasAssertions();

			const store = fakeStateStore();
			const result = await run({
				config: { environments: { production: {} }, universe: { universeId: "123" } },
				environment: "production",
				getEnv: environmentFrom({}),
				live: true,
				statePort: store.port,
			});

			expect(result).toMatchObject({
				err: { kind: "missingCredential", variable: "BEDROCK_API_KEY" },
				success: false,
			});
			expect(store.writes).toBeEmpty();
		},
	);

	it.for([deploy, provision, previewDiffAsync])(
		"should allow an audit with no edits without writing Roblox",
		async (run, { expect }) => {
			expect.hasAssertions();

			const subject = fixture(500);
			const result = await run({ ...subject.options, failOnOutOfBandEdit: true });
			assert(result.success, JSON.stringify(result));

			expect(subject.httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
				"GET",
			]);
		},
	);

	it.for([deploy, provision])(
		"should revert a live edit and persist desired state",
		async (run, { expect }) => {
			expect.hasAssertions();

			const subject = fixture();
			const result = await run(subject.options);
			assert(result.success, JSON.stringify(result));

			expect(subject.httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
				"GET",
				"PATCH",
			]);

			const { body } = subject.httpClient.requests[1]!.request;
			assert(body instanceof FormData);

			expect([
				body.get("name"),
				body.get("description"),
				body.get("price"),
				body.get("isForSale"),
			]).toStrictEqual([subject.current.name, subject.current.description, "500", "true"]);
			expect(subject.store.states.get("production")!.resources).toStrictEqual([
				{ ...subject.current, isManagedPricingEnabled: false },
			]);
			expect(
				subject.events.filter(({ kind }) => {
					return ["resourceOpStarted", "resourceOpSucceeded"].includes(kind);
				}),
			).toMatchObject([
				{ kind: "resourceOpStarted", opType: "update", reason: "outOfBandEdit" },
				{
					changedFields: ["price"],
					kind: "resourceOpSucceeded",
					opType: "update",
					reason: "outOfBandEdit",
				},
			]);
			expect(subject.events).toContainEqual(
				expect.objectContaining({ kind: "applySummary", reverted: 1, updated: 1 }),
			);
		},
	);

	it("should combine a config change and a live edit in one full-field update", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const subject = fixture();
		const result = await deploy({
			...subject.options,
			config: {
				...subject.options.config,
				passes: {
					"vip-pass": {
						...subject.options.config.passes["vip-pass"],
						description: "New description",
					},
				},
			},
		});
		assert(result.success);

		expect(subject.httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
			"GET",
			"PATCH",
		]);

		const { body } = subject.httpClient.requests[1]!.request;
		assert(body instanceof FormData);

		expect([body.get("description"), body.get("price")]).toStrictEqual([
			"New description",
			"500",
		]);
		expect(subject.events).toContainEqual(
			expect.objectContaining({
				changedFields: ["description", "price"],
				kind: "resourceOpSucceeded",
				reason: "outOfBandEdit",
			}),
		);
	});

	it("should save a config change that already matches Live without an update", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const subject = fixture();
		const result = await deploy({
			...subject.options,
			config: {
				...subject.options.config,
				passes: {
					"vip-pass": { ...subject.options.config.passes["vip-pass"], price: 120 },
				},
			},
		});
		assert(result.success);

		expect(subject.httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
			"GET",
		]);
		expect(subject.store.states.get("production")!.resources).toMatchObject([{ price: 120 }]);
		expect(subject.events).toContainEqual(expect.objectContaining({ kind: "resourceOpNoop" }));
	});

	it("should refuse an audit before a visibility transition", async ({ expect }) => {
		expect.hasAssertions();

		const subject = fixture();
		const result = await deploy({
			...subject.options,
			config: {
				...subject.options.config,
				universe: { universeId: "123", visibility: "public" },
			},
			failOnOutOfBandEdit: true,
		});

		expect(result).toMatchObject({ err: { kind: "outOfBandEdits" }, success: false });
		expect(subject.httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
			"GET",
		]);
		expect(subject.store.writes).toBeEmpty();
	});

	it("should render the live report, revert progress and summary", async ({ expect }) => {
		expect.hasAssertions();

		const subject = fixture();
		const clack = fakeClackPort();
		const result = await deploy({
			...subject.options,
			progress: createClackProgressAdapter({ clack }),
		});
		assert(result.success);

		expect(clack.logMessage).toHaveBeenCalledWith('Out-of-band edits for "production":');
		expect(clack.logSuccess).toHaveBeenCalledWith(
			"gamePass.vip-pass price reverted (out-of-band edit)",
		);
		expect(clack.logMessage).toHaveBeenCalledWith(
			expect.stringContaining("1 update, 1 revert"),
		);
	});

	it("should use State only when live checks are disabled", async ({ expect }) => {
		expect.hasAssertions();

		const subject = fixture();
		const result = await deploy({ ...subject.options, live: false });
		assert(result.success);

		expect(subject.httpClient.requests).toBeEmpty();

		const reported = subject.events.find(({ kind }) => kind === "liveCheck");
		assert(reported!.kind === "liveCheck");

		expect(reported.check.checkedKinds).toStrictEqual([]);
		expect(reported.check.skippedKinds).toContainEqual({
			kind: "gamePass",
			reason: "disabled",
		});
	});
});
