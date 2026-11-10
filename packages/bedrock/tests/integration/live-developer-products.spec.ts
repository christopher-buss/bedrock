import { asRobloxAssetId, createDeveloperProductDriver } from "@bedrock-rbx/core";
import { OpenCloudError } from "@bedrock-rbx/ocale";
import { DeveloperProductsClient } from "@bedrock-rbx/ocale/developer-products";
import { createFakeHttpClient, validDeveloperProductBody } from "@bedrock-rbx/ocale/testing";

import { assert, describe, it } from "vitest";

import { previewDiffAsync } from "#src/shell/preview-diff";
import { developerProductCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

const CURRENT = developerProductCurrent({ isManagedPricingEnabled: false, price: 100 });
const WIRE_BODY = validDeveloperProductBody({
	name: CURRENT.name,
	description: CURRENT.description,
	productId: 8_172_635_495,
});

function livePreview(httpClient = createFakeHttpClient()) {
	const store = fakeStateStore({
		initial: { production: { environment: "production", resources: [CURRENT], version: 1 } },
	});
	return {
		httpClient,
		options: {
			config: {
				environments: { production: {} },
				products: {
					"gem-pack": {
						name: CURRENT.name,
						description: CURRENT.description,
						price: 100,
					},
				},
			},
			environment: "production",
			registry: {
				developerProduct: createDeveloperProductDriver({
					client: new DeveloperProductsClient({
						credential: { apiKey: "fake", kind: "apiKey" },
						httpClient,
						sleep: async () => {},
					}),
					readFile: async () => {
						throw new Error("live reads must not read local icons");
					},
					universeId: asRobloxAssetId("123"),
				}),
			},
			statePort: store.port,
		},
		store,
	};
}

describe("developer-product live check", () => {
	it.for([
		{
			current: "Gem Pack",
			field: "name",
			label: "name",
			live: "Dashboard name",
			wire: { name: "Dashboard name" },
		},
		{
			current: "Stocks the player up with 1,000 premium gems.",
			field: "description",
			label: "description",
			live: "Dashboard description",
			wire: { description: "Dashboard description" },
		},
		{
			current: 100,
			field: "price",
			label: "price",
			live: 120,
			wire: { priceInformation: { defaultPriceInRobux: 120, enabledFeatures: [] } },
		},
		{
			current: 100,
			field: "price",
			label: "off-sale status with a retained price",
			live: undefined,
			wire: { isForSale: false },
		},
		{
			current: 100,
			field: "price",
			label: "missing on-sale pricing",
			live: undefined,
			wire: { priceInformation: JSON.parse("null") },
		},
		{
			current: false,
			field: "isManagedPricingEnabled",
			label: "managed pricing",
			live: true,
			wire: { isManagedPricingEnabled: true },
		},
	])(
		"should report an out-of-band $label edit with no config drift",
		async ({ current, field, live, wire }, { expect }) => {
			expect.hasAssertions();

			const fixture = livePreview(
				createFakeHttpClient().mockResponse({
					body: {
						developerProducts: [{ ...WIRE_BODY, ...wire }],
						nextPageToken: JSON.parse("null"),
					},
					status: 200,
				}),
			);
			const result = await previewDiffAsync(fixture.options);
			assert(result.success);

			expect(result.data.liveCheck!.edits).toStrictEqual([
				{
					key: "gem-pack",
					fields: [{ current, field, live }],
					kind: "developerProduct",
				},
			]);
			expect(result.data.drift).toStrictEqual([
				{ key: "gem-pack", kind: "developerProduct", type: "noop" },
			]);
			expect(result.data.ops).toMatchObject([
				{ changedFields: [field], current: { [field]: live }, type: "update" },
			]);
			expect(fixture.httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
				"GET",
			]);
			expect(fixture.store.writes).toBeEmpty();
		},
	);

	it("should finish every product page before reporting missing products and leave unchanged products alone", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = livePreview(
			createFakeHttpClient()
				.mockResponse({
					body: {
						developerProducts: [validDeveloperProductBody()],
						nextPageToken: "next",
					},
					status: 200,
				})
				.mockResponse({
					body: { developerProducts: [WIRE_BODY], nextPageToken: JSON.parse("null") },
					status: 200,
				}),
		);
		const result = await previewDiffAsync(fixture.options);
		assert(result.success);

		expect(result.data.liveCheck).toMatchObject({
			checkedKinds: ["developerProduct"],
			edits: [],
			missing: [],
		});
		expect(result.data.ops).toStrictEqual([
			{ key: "gem-pack", kind: "developerProduct", type: "noop" },
		]);
		expect(
			fixture.httpClient.requests.map(({ request }) => {
				return {
					method: request.method,
					url: request.url,
				};
			}),
		).toStrictEqual([
			{
				method: "GET",
				url: "/developer-products/v2/universes/123/developer-products/creator",
			},
			{
				method: "GET",
				url: "/developer-products/v2/universes/123/developer-products/creator?pageToken=next",
			},
		]);
		expect(fixture.store.writes).toBeEmpty();
	});

	it("should report a tracked product missing from a complete list", async ({ expect }) => {
		expect.hasAssertions();

		const fixture = livePreview(
			createFakeHttpClient().mockResponse({
				body: { developerProducts: [], nextPageToken: JSON.parse("null") },
				status: 200,
			}),
		);
		const result = await previewDiffAsync(fixture.options);
		assert(result.success);

		expect(result.data.liveCheck).toMatchObject({
			checkedKinds: ["developerProduct"],
			edits: [],
			missing: [{ key: "gem-pack", kind: "developerProduct", robloxId: "8172635495" }],
		});
		expect(fixture.store.writes).toBeEmpty();
	});

	it("should fail the preview without writing when a later product page fails", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const cause = new OpenCloudError("product read refused");
		const fixture = livePreview(
			createFakeHttpClient()
				.mockResponse({
					body: { developerProducts: [WIRE_BODY], nextPageToken: "next" },
					status: 200,
				})
				.mockError(cause),
		);

		await expect(previewDiffAsync(fixture.options)).resolves.toStrictEqual({
			err: { cause, kind: "liveCheckFailed", resourceKind: "developerProduct" },
			success: false,
		});
		expect(fixture.store.writes).toBeEmpty();
	});

	it("should preview a live product price edit separately from config drift without writing", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = livePreview(
			createFakeHttpClient().mockResponse({
				body: {
					developerProducts: [
						{
							...WIRE_BODY,
							priceInformation: { defaultPriceInRobux: 120, enabledFeatures: [] },
						},
					],
					nextPageToken: JSON.parse("null"),
				},
				status: 200,
			}),
		);
		const result = await previewDiffAsync({
			...fixture.options,
			config: {
				...fixture.options.config,
				products: {
					"gem-pack": {
						...fixture.options.config.products["gem-pack"],
						description: "New description.",
					},
				},
			},
		});
		assert(result.success);

		expect(result.data.liveCheck).toStrictEqual({
			checkedKinds: ["developerProduct"],
			edits: [
				{
					key: "gem-pack",
					fields: [{ current: 100, field: "price", live: 120 }],
					kind: "developerProduct",
				},
			],
			missing: [],
			skippedKinds: [
				{ kind: "badge", reason: "unsupported" },
				{ kind: "gamePass", reason: "unsupported" },
				{ kind: "place", reason: "unsupported" },
				{ kind: "universe", reason: "unsupported" },
			],
		});
		expect(result.data.drift).toMatchObject([
			{ changedFields: ["description"], type: "update" },
		]);
		expect(result.data.ops).toMatchObject([
			{
				changedFields: ["description", "price"],
				current: { price: 120 },
				desired: { price: 100 },
				type: "update",
			},
		]);
		expect(
			fixture.httpClient.requests.map(({ request }) => {
				return {
					method: request.method,
					url: request.url,
				};
			}),
		).toStrictEqual([
			{
				method: "GET",
				url: "/developer-products/v2/universes/123/developer-products/creator",
			},
		]);
		expect(fixture.store.writes).toBeEmpty();
	});
});
