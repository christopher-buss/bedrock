import { asRobloxAssetId, createBadgeDriver } from "@bedrock-rbx/core";
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
