import { asRobloxAssetId, createBadgeDriver, deploy, type ProgressEvent } from "@bedrock-rbx/core";
import { ApiError, OpenCloudError, UnexpectedResponseError } from "@bedrock-rbx/ocale";
import { BadgesClient } from "@bedrock-rbx/ocale/badges";
import { createFakeHttpClient, validBadgeBody } from "@bedrock-rbx/ocale/testing";

import { assert, describe, it } from "vitest";

import { previewDiffAsync } from "#src/shell/preview-diff";
import { badgeCurrent, gamePassCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";
import { fakeUniverses } from "#tests/helpers/universe-owner";

function livePreview(httpClient = createFakeHttpClient(), current = badgeCurrent()) {
	const store = fakeStateStore({
		initial: { production: { environment: "production", resources: [current], version: 1 } },
	});
	return {
		current,
		httpClient,
		options: {
			config: {
				badges: {
					"first-win": {
						name: current.name,
						description: current.description,
						enabled: current.enabled,
						icon: current.icon,
					},
				},
				environments: { production: {} },
			},
			environment: "production",
			readFile: async () => new Uint8Array(),
			registry: {
				badge: createBadgeDriver({
					client: new BadgesClient({
						credential: { apiKey: "fake", kind: "apiKey" },
						httpClient,
						sleep: async () => {},
					}),
					readFile: async () => new Uint8Array(),
					universeId: asRobloxAssetId("123"),
					universes: fakeUniverses(),
				}),
			},
			statePort: store.port,
		},
		store,
	};
}

function liveBadge(overrides: Parameters<typeof validBadgeBody>[0] = {}) {
	const { awarder: _awarder, ...badge } = validBadgeBody({
		id: 2_468_013_579,
		name: "First Win",
		description: "Win your first round.",
		iconImageId: 1_357_924_680,
		...overrides,
	});
	return { ...badge, awardingUniverse: { id: 123, name: "Game", rootPlaceId: 456 } };
}

function page(data: Array<ReturnType<typeof liveBadge>>, nextPageCursor?: string) {
	return { data, nextPageCursor };
}

const trap = {
	create(): never {
		throw new Error("Unexpected create");
	},
	retire(): never {
		throw new Error("Unexpected retire");
	},
};

function liveDeploy(httpClient = createFakeHttpClient(), current = badgeCurrent()) {
	const fixture = livePreview(httpClient, current);
	const events: Array<ProgressEvent> = [];
	return {
		...fixture,
		events,
		options: {
			...fixture.options,
			progress: {
				emit: (event: ProgressEvent) => {
					events.push(event);
				},
			},
			registry: {
				...fixture.options.registry,
				developerProduct: trap,
				gamePass: trap,
				place: trap,
				universe: trap,
			},
		},
	};
}

describe("badge live deploy", () => {
	it("should honor live:false without listing or reading badges", async ({ expect }) => {
		expect.hasAssertions();

		const fixture = liveDeploy();
		const result = await deploy({ ...fixture.options, live: false });
		assert(result.success);

		expect(fixture.httpClient.requests).toBeEmpty();
		expect(fixture.events.filter(({ kind }) => kind === "liveCheck")).toMatchObject([
			{
				check: {
					checkedKinds: [],
					skippedKinds: [
						{ kind: "badge", reason: "disabled" },
						{ kind: "developerProduct", reason: "disabled" },
						{ kind: "gamePass", reason: "disabled" },
						{ kind: "place", reason: "disabled" },
						{ kind: "universe", reason: "disabled" },
					],
				},
			},
		]);
		expect(fixture.events.filter(({ kind }) => kind === "applySummary")).toMatchObject([
			{ noop: 1, updated: 0 },
		]);
	});

	it("should refuse a disabled badge audit before any operation or State write", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = liveDeploy(
			createFakeHttpClient()
				.mockResponse({ body: page([]), status: 200 })
				.mockResponse({ body: liveBadge({ enabled: false }), status: 200 }),
		);
		const result = await deploy({ ...fixture.options, failOnOutOfBandEdit: true });

		expect(result).toMatchObject({
			err: {
				edits: [
					{
						key: "first-win",
						fields: [{ current: true, field: "enabled", live: false }],
						kind: "badge",
					},
				],
				kind: "outOfBandEdits",
			},
			success: false,
		});
		expect(
			fixture.httpClient.requests.map(({ request }) => [request.method, request.url]),
		).toStrictEqual([
			["GET", "/v1/universes/123/badges?limit=100"],
			["GET", "/v1/badges/2468013579"],
		]);
		expect(fixture.store.writes).toBeEmpty();
		expect(fixture.store.states.get("production")!.resources).toStrictEqual([fixture.current]);
		expect(fixture.events.filter(({ kind }) => kind === "resourceOpStarted")).toBeEmpty();
	});

	it("should restore every managed scalar in one update when config and live edits change together", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = liveDeploy(
			createFakeHttpClient()
				.mockResponse({
					body: page([
						liveBadge({ name: "Edited name", description: "Edited description" }),
					]),
					status: 200,
				})
				.mockResponse({ status: 200 })
				.mockResponse({ body: page([]), status: 200 })
				.mockResponse({
					body: liveBadge({ description: "Reviewed description", enabled: false }),
					status: 200,
				}),
		);
		const options = {
			...fixture.options,
			config: {
				...fixture.options.config,
				badges: {
					"first-win": {
						...fixture.options.config.badges["first-win"],
						description: "Reviewed description",
						enabled: false,
					},
				},
			},
		};
		const first = await deploy(options);
		assert(first.success, JSON.stringify(first));
		const second = await deploy(options);
		assert(second.success, JSON.stringify(second));

		expect(
			fixture.httpClient.requests.map(({ request }) => [
				request.method,
				request.url,
				request.body,
			]),
		).toStrictEqual([
			["GET", "/v1/universes/123/badges?limit=100", undefined],
			[
				"PATCH",
				"/legacy-badges/v1/badges/2468013579",
				{ name: "First Win", description: "Reviewed description", enabled: false },
			],
			["GET", "/v1/universes/123/badges?limit=100", undefined],
			["GET", "/v1/badges/2468013579", undefined],
		]);
		expect(fixture.store.states.get("production")!.resources).toStrictEqual([
			{ ...fixture.current, description: "Reviewed description", enabled: false },
		]);
		expect(second.data.resources).toStrictEqual(first.data.resources);
		expect(fixture.events.filter(({ kind }) => kind === "resourceOpSucceeded")).toMatchObject([
			{
				changedFields: ["description", "enabled", "name"],
				opType: "update",
				reason: "outOfBandEdit",
			},
		]);
		expect(fixture.events.filter(({ kind }) => kind === "applySummary")).toMatchObject([
			{ reverted: 1, updated: 1 },
			{ noop: 1, updated: 0 },
		]);
	});

	it("should refuse insufficient create capacity before restoring a disabled badge", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = liveDeploy(
			createFakeHttpClient()
				.mockResponse({ body: page([]), status: 200 })
				.mockResponse({ body: liveBadge({ enabled: false }), status: 200 })
				.mockResponse({ body: 0, status: 200 }),
		);
		const result = await deploy({
			...fixture.options,
			config: {
				...fixture.options.config,
				badges: {
					...fixture.options.config.badges,
					"second-win": {
						...fixture.options.config.badges["first-win"],
						name: "Second Win",
					},
				},
			},
		});

		expect(result).toMatchObject({
			err: { available: 0, kind: "badgeQuotaExceeded", needed: 1 },
			success: false,
		});
		expect(
			fixture.httpClient.requests.map(({ request }) => [request.method, request.url]),
		).toStrictEqual([
			["GET", "/v1/universes/123/badges?limit=100"],
			["GET", "/v1/badges/2468013579"],
			["GET", "/v1/universes/123/free-badges-quota"],
		]);
		expect(fixture.store.writes).toBeEmpty();
		expect(fixture.store.states.get("production")!.resources).toStrictEqual([fixture.current]);
		expect(fixture.events.filter(({ kind }) => kind === "resourceOpStarted")).toBeEmpty();
	});

	it.for([
		{ label: "first list page", pages: [], urls: ["/v1/universes/123/badges?limit=100"] },
		{
			label: "later list page",
			pages: [page([], "next")],
			urls: [
				"/v1/universes/123/badges?limit=100",
				"/v1/universes/123/badges?limit=100&cursor=next",
			],
		},
		{
			label: "single-badge fallback",
			pages: [page([])],
			urls: ["/v1/universes/123/badges?limit=100", "/v1/badges/2468013579"],
		},
	])(
		"should stop without an operation or State write when the $label fails",
		async ({ pages, urls }, { expect }) => {
			expect.hasAssertions();

			const cause = new OpenCloudError("Badge read failed");
			const httpClient = pages
				.reduce(
					(http, body) => http.mockResponse({ body, status: 200 }),
					createFakeHttpClient(),
				)
				.mockError(cause);
			const fixture = liveDeploy(httpClient);
			const result = await deploy(fixture.options);

			expect(result).toStrictEqual({
				err: { cause, kind: "liveCheckFailed", resourceKind: "badge" },
				success: false,
			});
			expect(
				fixture.httpClient.requests.map(({ request }) => [request.method, request.url]),
			).toStrictEqual(urls.map((url) => ["GET", url]));
			expect(fixture.store.writes).toBeEmpty();
			expect(fixture.store.states.get("production")!.resources).toStrictEqual([
				fixture.current,
			]);
			expect(fixture.events.filter(({ kind }) => kind === "resourceOpStarted")).toBeEmpty();
		},
	);

	it("should refuse a deployment whose tracked badge is missing without any operation or State write", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = liveDeploy(
			createFakeHttpClient()
				.mockResponse({ body: page([]), status: 200 })
				.mockError(new ApiError("Badge does not exist", { statusCode: 404 })),
		);
		const result = await deploy(fixture.options);
		assert(!result.success);
		assert(result.err.kind === "liveCheckFailed");

		expect([result.err.resourceKind, result.err.cause.message]).toStrictEqual([
			"badge",
			"Tracked badge:first-win (2468013579) is missing from Roblox",
		]);
		expect(
			fixture.httpClient.requests.map(({ request }) => [request.method, request.url]),
		).toStrictEqual([
			["GET", "/v1/universes/123/badges?limit=100"],
			["GET", "/v1/badges/2468013579"],
		]);
		expect(fixture.store.writes).toBeEmpty();
		expect(fixture.store.states.get("production")!.resources).toStrictEqual([fixture.current]);
		expect(fixture.events.filter(({ kind }) => kind === "resourceOpStarted")).toBeEmpty();
	});

	it("should restore badge text, persist the restored State, and leave the next deployment unchanged", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = liveDeploy(
			createFakeHttpClient()
				.mockResponse({
					body: page([
						liveBadge({ name: "Edited name", description: "Edited description" }),
					]),
					status: 200,
				})
				.mockResponse({ status: 200 })
				.mockResponse({ body: page([liveBadge()]), status: 200 }),
		);
		const first = await deploy(fixture.options);
		assert(first.success, JSON.stringify(first));
		const second = await deploy(fixture.options);
		assert(second.success, JSON.stringify(second));

		expect(
			fixture.httpClient.requests.map(({ request }) => [
				request.method,
				request.url,
				request.body,
			]),
		).toStrictEqual([
			["GET", "/v1/universes/123/badges?limit=100", undefined],
			[
				"PATCH",
				"/legacy-badges/v1/badges/2468013579",
				{ name: "First Win", description: "Win your first round.", enabled: true },
			],
			["GET", "/v1/universes/123/badges?limit=100", undefined],
		]);
		expect(fixture.store.states.get("production")!.resources).toStrictEqual([fixture.current]);
		expect(second.data.resources).toStrictEqual(first.data.resources);
		expect(fixture.events.filter(({ kind }) => kind === "applySummary")).toMatchObject([
			{ noop: 0, reverted: 1, updated: 1 },
			{ noop: 1, updated: 0 },
		]);
		expect(fixture.events.filter(({ kind }) => kind === "resourceOpSucceeded")).toMatchObject([
			{
				changedFields: ["description", "name"],
				opType: "update",
				reason: "outOfBandEdit",
				resourceKind: "badge",
			},
		]);
	});

	it("should find a disabled tracked badge after pagination, enable it, and settle to a noop", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = liveDeploy(
			createFakeHttpClient()
				.mockResponse({
					body: page([liveBadge({ id: 77, name: "Untracked" })], "next"),
					status: 200,
				})
				.mockResponse({ body: page([]), status: 200 })
				.mockResponse({ body: liveBadge({ enabled: false }), status: 200 })
				.mockResponse({ status: 200 })
				.mockResponse({ body: page([liveBadge()]), status: 200 }),
		);
		const first = await deploy(fixture.options);
		assert(first.success, JSON.stringify(first));
		const second = await deploy(fixture.options);
		assert(second.success, JSON.stringify(second));

		expect(
			fixture.httpClient.requests.map(({ request }) => [request.method, request.url]),
		).toStrictEqual([
			["GET", "/v1/universes/123/badges?limit=100"],
			["GET", "/v1/universes/123/badges?limit=100&cursor=next"],
			["GET", "/v1/badges/2468013579"],
			["PATCH", "/legacy-badges/v1/badges/2468013579"],
			["GET", "/v1/universes/123/badges?limit=100"],
		]);
		expect(fixture.httpClient.requests[3]!.request.body).toStrictEqual({
			name: "First Win",
			description: "Win your first round.",
			enabled: true,
		});
		expect(fixture.store.states.get("production")!.resources).toStrictEqual([fixture.current]);
		expect(fixture.events.filter(({ kind }) => kind === "applySummary")).toMatchObject([
			{ reverted: 1, updated: 1 },
			{ noop: 1, updated: 0 },
		]);
		expect(fixture.events.filter(({ kind }) => kind === "liveCheck")).toMatchObject([
			{
				check: {
					checkedKinds: ["badge"],
					edits: [{ fields: [{ current: true, field: "enabled", live: false }] }],
					missing: [],
				},
			},
			{ check: { edits: [], missing: [] } },
		]);
	});
});

describe("badge live check", () => {
	it("should report a badge missing only after its fallback get returns an API 404", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = livePreview(
			createFakeHttpClient()
				.mockResponse({ body: page([]), status: 200 })
				.mockError(new ApiError("Badge does not exist", { statusCode: 404 })),
		);
		const result = await previewDiffAsync(fixture.options);
		assert(result.success);

		expect(result.data.liveCheck).toMatchObject({
			checkedKinds: ["badge"],
			edits: [],
			missing: [{ key: "first-win", kind: "badge", robloxId: "2468013579" }],
		});
		expect(fixture.httpClient.requests.map(({ request }) => request.url)).toStrictEqual([
			"/v1/universes/123/badges?limit=100",
			"/v1/badges/2468013579",
		]);
		expect(fixture.store.writes).toBeEmpty();
	});

	it.for([
		new ApiError("Badge read forbidden", { statusCode: 403 }),
		new OpenCloudError("Badge read failed"),
		new UnexpectedResponseError("Malformed response", { statusCode: 404 }),
	])(
		"should fail the live check instead of reporting a missing badge when its get fails: %s",
		async (cause, { expect }) => {
			expect.hasAssertions();

			const fixture = livePreview(
				createFakeHttpClient()
					.mockResponse({ body: page([]), status: 200 })
					.mockError(cause),
			);
			const result = await previewDiffAsync(fixture.options);

			expect(result).toStrictEqual({
				err: { cause, kind: "liveCheckFailed", resourceKind: "badge" },
				success: false,
			});
			expect(fixture.httpClient.requests.map(({ request }) => request.url)).toStrictEqual([
				"/v1/universes/123/badges?limit=100",
				"/v1/badges/2468013579",
			]);
			expect(fixture.store.writes).toBeEmpty();
		},
	);

	it("should leave a badge configured as disabled unchanged after the fallback get", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = livePreview(
			createFakeHttpClient()
				.mockResponse({ body: page([]), status: 200 })
				.mockResponse({ body: liveBadge({ enabled: false }), status: 200 }),
			badgeCurrent({ enabled: false }),
		);
		const result = await previewDiffAsync(fixture.options);
		assert(result.success);

		expect(result.data.liveCheck).toMatchObject({ edits: [], missing: [] });
		expect(result.data.ops).toStrictEqual([{ key: "first-win", kind: "badge", type: "noop" }]);
		expect(fixture.httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
			"GET",
			"GET",
		]);
	});

	it("should keep a missing badge report when a caller's list driver has no single reader", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = livePreview(
			createFakeHttpClient().mockResponse({ body: page([]), status: 200 }),
		);
		const { read: _read, ...listOnly } = fixture.options.registry.badge;
		const result = await previewDiffAsync({
			...fixture.options,
			registry: { badge: listOnly },
		});
		assert(result.success);

		expect(result.data.liveCheck!.missing).toStrictEqual([
			{ key: "first-win", kind: "badge", robloxId: "2468013579" },
		]);
		expect(fixture.httpClient.requests.map(({ request }) => request.url)).toStrictEqual([
			"/v1/universes/123/badges?limit=100",
		]);
	});

	it("should read only tracked badges when another kind is also tracked", async ({ expect }) => {
		expect.hasAssertions();

		const fixture = livePreview(
			createFakeHttpClient()
				.mockResponse({ body: page([]), status: 200 })
				.mockResponse({ body: liveBadge(), status: 200 }),
		);
		const pass = gamePassCurrent();
		const store = fakeStateStore({
			initial: {
				production: {
					environment: "production",
					resources: [pass, fixture.current],
					version: 1,
				},
			},
		});
		const result = await previewDiffAsync({
			...fixture.options,
			config: {
				...fixture.options.config,
				passes: {
					"vip-pass": {
						name: pass.name,
						description: pass.description,
						icon: pass.icon,
						price: 500,
					},
				},
			},
			statePort: store.port,
		});
		assert(result.success);

		expect(result.data.liveCheck).toMatchObject({
			checkedKinds: ["badge"],
			edits: [],
			missing: [],
		});
		expect(result.data.ops).toStrictEqual(
			expect.arrayContaining([
				{ key: "first-win", kind: "badge", type: "noop" },
				{ key: "vip-pass", kind: "gamePass", type: "noop" },
			]),
		);
		expect(fixture.httpClient.requests.map(({ request }) => request.url)).toStrictEqual([
			"/v1/universes/123/badges?limit=100",
			"/v1/badges/2468013579",
		]);
	});

	it("should read a tracked badge absent from the complete list and report its disabled state and text edits", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = livePreview(
			createFakeHttpClient()
				.mockResponse({ body: page([liveBadge({ id: 77 })], "next"), status: 200 })
				.mockResponse({ body: page([]), status: 200 })
				.mockResponse({
					body: liveBadge({
						name: "Edited",
						description: "Changed",
						enabled: false,
						iconImageId: 99,
					}),
					status: 200,
				}),
		);
		const result = await previewDiffAsync(fixture.options);
		assert(result.success);

		expect(result.data.liveCheck).toMatchObject({
			checkedKinds: ["badge"],
			edits: [
				{
					key: "first-win",
					fields: [
						{ current: "Win your first round.", field: "description", live: "Changed" },
						{ current: true, field: "enabled", live: false },
						{ current: "First Win", field: "name", live: "Edited" },
					],
					kind: "badge",
				},
			],
			missing: [],
		});
		expect(result.data.ops).toMatchObject([
			{
				changedFields: ["description", "enabled", "name"],
				current: { enabled: false, outputs: { iconImageId: "99" } },
				desired: { enabled: true },
				type: "update",
			},
		]);
		expect(
			fixture.httpClient.requests.map(({ request }) => [request.method, request.url]),
		).toStrictEqual([
			["GET", "/v1/universes/123/badges?limit=100"],
			["GET", "/v1/universes/123/badges?limit=100&cursor=next"],
			["GET", "/v1/badges/2468013579"],
		]);
		expect(fixture.store.writes).toBeEmpty();
	});

	it("should preview source-language badge text edits separately from config drift without writing", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = livePreview(
			createFakeHttpClient().mockResponse({
				body: page([
					liveBadge({
						name: "Edited name",
						description: "Edited description",
						displayDescription: "Localized description",
						displayName: "Localized",
						iconImageId: 99,
					}),
				]),
				status: 200,
			}),
		);
		const result = await previewDiffAsync(fixture.options);
		assert(result.success);

		expect(result.data.liveCheck).toMatchObject({
			checkedKinds: ["badge"],
			edits: [
				{
					key: "first-win",
					fields: [
						{
							current: "Win your first round.",
							field: "description",
							live: "Edited description",
						},
						{ current: "First Win", field: "name", live: "Edited name" },
					],
					kind: "badge",
				},
			],
			missing: [],
		});
		expect(result.data.drift).toStrictEqual([
			{ key: "first-win", kind: "badge", type: "noop" },
		]);
		expect(result.data.ops).toMatchObject([
			{
				changedFields: ["description", "name"],
				current: {
					name: "Edited name",
					description: "Edited description",
					icon: fixture.current.icon,
					iconFileHashes: fixture.current.iconFileHashes,
					outputs: { badgeId: "2468013579", iconImageId: "99" },
				},
				type: "update",
			},
		]);
		expect(
			fixture.httpClient.requests.map(({ request }) => [request.method, request.url]),
		).toStrictEqual([["GET", "/v1/universes/123/badges?limit=100"]]);
		expect(fixture.store.writes).toBeEmpty();
	});

	it("should finish every list page without importing untracked badges or reading listed badges individually", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = livePreview(
			createFakeHttpClient()
				.mockResponse({
					body: page([liveBadge({ id: 77, name: "Untracked" })], "next"),
					status: 200,
				})
				.mockResponse({ body: page([liveBadge()]), status: 200 }),
		);
		const result = await previewDiffAsync(fixture.options);
		assert(result.success);

		expect(result.data.liveCheck).toMatchObject({
			checkedKinds: ["badge"],
			edits: [],
			missing: [],
		});
		expect(result.data.ops).toStrictEqual([{ key: "first-win", kind: "badge", type: "noop" }]);
		expect(
			fixture.httpClient.requests.map(({ request }) => [request.method, request.url]),
		).toStrictEqual([
			["GET", "/v1/universes/123/badges?limit=100"],
			["GET", "/v1/universes/123/badges?limit=100&cursor=next"],
		]);
		expect(fixture.store.writes).toBeEmpty();
	});

	it("should retain the saved icon baseline when Roblox has no readable icon ID", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = livePreview(
			createFakeHttpClient().mockResponse({
				body: page([liveBadge({ name: "Edited", iconImageId: 0 })]),
				status: 200,
			}),
		);
		const result = await previewDiffAsync(fixture.options);
		assert(result.success);

		expect(result.data.liveCheck!.edits).toStrictEqual([
			{
				key: "first-win",
				fields: [{ current: "First Win", field: "name", live: "Edited" }],
				kind: "badge",
			},
		]);
		expect(result.data.ops).toMatchObject([
			{
				current: { outputs: { badgeId: "2468013579", iconImageId: "1357924680" } },
				type: "update",
			},
		]);
	});

	it("should fail the preview when a later badge list page cannot be read", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const cause = new OpenCloudError("badge list refused");
		const fixture = livePreview(
			createFakeHttpClient()
				.mockResponse({ body: page([], "next"), status: 200 })
				.mockError(cause),
		);
		const result = await previewDiffAsync(fixture.options);

		expect(result).toStrictEqual({
			err: { cause, kind: "liveCheckFailed", resourceKind: "badge" },
			success: false,
		});
		expect(fixture.httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
			"GET",
			"GET",
		]);
		expect(fixture.store.writes).toBeEmpty();
	});
});
