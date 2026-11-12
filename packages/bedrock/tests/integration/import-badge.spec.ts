import { asResourceKey, asRobloxAssetId, createBadgeDriver, deploy } from "@bedrock-rbx/core";
import { BadgesClient } from "@bedrock-rbx/ocale/badges";
import { DeveloperProductsClient } from "@bedrock-rbx/ocale/developer-products";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validBadgeBody,
	validDeveloperProductBody,
} from "@bedrock-rbx/ocale/testing";

import { assert, describe, it } from "vitest";

import { createDeveloperProductDriver } from "#src/adapters/developer-product-driver";
import type { ResourceCurrentState } from "#src/core/resources";
import type { EnvironmentEntry } from "#src/core/schema";
import type { BedrockState } from "#src/core/state";
import type { DriverRegistry } from "#src/ports/resource-driver";
import { previewDiffAsync } from "#src/shell/preview-diff";
import { badgeCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";
import { fakeUniverses } from "#tests/helpers/universe-owner";

type BadgeOverlay = NonNullable<EnvironmentEntry["badges"]>[string];

const BADGE_ID = "2468013579";
const LINE = `environments.production.badges.first-win.importId "${BADGE_ID}"`;

const trap = {
	create() {
		throw new Error("Unexpected create");
	},
	retire() {
		throw new Error("Unexpected retire");
	},
};

function fakeClient(http: FakeHttpClient) {
	return {
		credential: { apiKey: "fake", kind: "apiKey" as const },
		httpClient: http,
		sleep: async () => {},
	};
}

function badgeBody(overrides: Parameters<typeof validBadgeBody>[0] = {}) {
	const { awarder: _awarder, ...badge } = validBadgeBody({
		id: Number(BADGE_ID),
		name: "First Win",
		description: "Win your first round.",
		iconImageId: 1_357_924_680,
		...overrides,
	});
	return { ...badge, awardingUniverse: { id: 123, name: "Game", rootPlaceId: 456 } };
}

function page(data: Array<ReturnType<typeof badgeBody>>) {
	return { data, nextPageCursor: undefined };
}

function savedIn(resource: ResourceCurrentState): Readonly<Record<string, BedrockState>> {
	return { production: { environment: "production", resources: [resource], version: 1 } };
}

function badgeRegistry(http: FakeHttpClient): DriverRegistry {
	return {
		badge: createBadgeDriver({
			client: new BadgesClient(fakeClient(http)),
			readFile: async () => new Uint8Array(),
			universeId: asRobloxAssetId("123"),
			universes: fakeUniverses(),
		}),
		// Single reads only, so the live check lists badges alone.
		developerProduct: {
			...trap,
			read: createDeveloperProductDriver({
				client: new DeveloperProductsClient(fakeClient(http)),
				readFile: async () => new Uint8Array(),
				universeId: asRobloxAssetId("123"),
			}).read!,
		},
		gamePass: trap,
		place: trap,
		universe: trap,
	};
}

function badgeOptions({
	enabled = true,
	http,
	initial,
	overlay = { iconBaseline: "accept-local-file", importId: BADGE_ID },
}: {
	readonly enabled?: boolean;
	readonly http: FakeHttpClient;
	readonly initial?: Readonly<Record<string, BedrockState>>;
	readonly overlay?: BadgeOverlay;
}) {
	const store = fakeStateStore(initial === undefined ? {} : { initial });
	return {
		options: {
			config: {
				badges: {
					"first-win": {
						name: "First Win",
						description: "Win your first round.",
						enabled,
						icon: { "en-us": "assets/first-win.png" },
					},
				},
				environments: { production: { badges: { "first-win": overlay } } },
			},
			environment: "production",
			readFile: async () => new Uint8Array(),
			registry: badgeRegistry(http),
			statePort: store.port,
		},
		store,
	};
}

describe("badge import", () => {
	it("should record an import on deploy without a write request, then plan a noop", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse({ body: badgeBody(), status: 200 })
			.mockResponse({ body: page([badgeBody()]), status: 200 })
			.mockResponse({ body: page([badgeBody()]), status: 200 });
		const { options, store } = badgeOptions({ http });
		const first = await deploy(options);
		assert(first.success, JSON.stringify(first));
		const second = await previewDiffAsync(options);
		assert(second.success, JSON.stringify(second));

		expect(store.states.get("production")!.resources).toStrictEqual([badgeCurrent()]);
		expect(http.requests.every(({ request }) => request.method === "GET")).toBeTrue();
		expect(second.data.imports).toStrictEqual([]);
		expect(second.data.ops).toStrictEqual([{ key: "first-win", kind: "badge", type: "noop" }]);
	});

	it("should import a disabled badge by its id", async ({ expect }) => {
		expect.hasAssertions();

		const disabled = badgeBody({ enabled: false });
		const http = createFakeHttpClient()
			.mockResponse({ body: disabled, status: 200 })
			.mockResponse({ body: page([]), status: 200 })
			.mockResponse({ body: disabled, status: 200 });
		const { options, store } = badgeOptions({ enabled: false, http });
		const result = await previewDiffAsync(options);
		assert(result.success, JSON.stringify(result));

		expect(result.data.imports).toStrictEqual([
			{ key: "first-win", kind: "badge", robloxId: BADGE_ID },
		]);
		expect(result.data.ops).toStrictEqual([{ key: "first-win", kind: "badge", type: "noop" }]);
		expect(http.requests.every(({ request }) => request.method === "GET")).toBeTrue();
		expect(store.writes).toBeEmpty();
	});
});

describe("badge import refusals", () => {
	it.for([
		{
			name: "an id that is not live",
			http: () => {
				return createFakeHttpClient()
					.mockApiError({ statusCode: 404 })
					.mockApiError({ statusCode: 404 });
			},
			reason: "is not a live badge in this Environment's universe.",
		},
		{
			name: "an id of another Kind",
			http: () => {
				return createFakeHttpClient()
					.mockApiError({ statusCode: 404 })
					.mockResponse({
						body: validDeveloperProductBody({ productId: Number(BADGE_ID) }),
						status: 200,
					});
			},
			reason: "is a developer product, not a badge.",
		},
		{
			name: "an id another Key tracks",
			http: () => createFakeHttpClient(),
			initial: savedIn(badgeCurrent({ key: asResourceKey("last-win") })),
			reason: "cannot be imported: 'last-win' already tracks it.",
		},
		{
			name: "a Key that already has State",
			http: () => createFakeHttpClient(),
			initial: savedIn(
				badgeCurrent({
					outputs: { ...badgeCurrent().outputs, badgeId: asRobloxAssetId("1") },
				}),
			),
			reason: "cannot be imported: 'first-win' already has State.",
		},
		{
			name: "an icon without a baseline",
			http: () => createFakeHttpClient().mockResponse({ body: badgeBody(), status: 200 }),
			overlay: { importId: BADGE_ID },
			reason: 'has no known icon hash: supply the icon file and add iconBaseline: "accept-local-file" beside importId.',
		},
	])(
		"should stop diff and deploy before any Operation for $name",
		async (refusal, { expect }) => {
			expect.hasAssertions();

			const http = refusal.http();
			const { options, store } = badgeOptions({ ...refusal, http });
			const previewed = await previewDiffAsync(options);
			const replay = refusal.http();
			const deployed = await deploy({
				...badgeOptions({ ...refusal, http: replay }).options,
				statePort: store.port,
			});

			expect(previewed).toStrictEqual(deployed);
			expect(previewed).toMatchObject({
				err: {
					cause: {
						key: "first-win",
						kind: "importRejected",
						message: `${LINE} ${refusal.reason}`,
					},
					kind: "buildDesiredFailed",
				},
				success: false,
			});
			expect(
				[...http.requests, ...replay.requests].every(
					({ request }) => request.method === "GET",
				),
			).toBeTrue();
			expect(store.writes).toBeEmpty();
		},
	);
});
