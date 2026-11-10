import { deploy, provision } from "@bedrock-rbx/core";
import { OpenCloudError } from "@bedrock-rbx/ocale";
import { createFakeHttpClient, validDeveloperProductBody } from "@bedrock-rbx/ocale/testing";

import { assert, describe, it } from "vitest";

import { liveProductCurrent, liveProductFixture } from "#tests/helpers/live-developer-product";

const WIRE_BODY = validDeveloperProductBody({
	name: "Gem Pack",
	description: "Stocks the player up with 1,000 premium gems.",
	iconImageAssetId: 1_122_334_455,
	productId: 8_172_635_495,
});

function formFields(body: FormData): Record<string, Blob | string> {
	const fields: Record<string, Blob | string> = {};
	for (const key of body.keys()) {
		fields[key] = body.get(key)!;
	}

	return fields;
}

describe("developer-product live deploy", () => {
	it("should combine a config description change and external price edit in one update after reading all pages", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse({
				body: {
					developerProducts: [validDeveloperProductBody()],
					nextPageToken: "next products",
				},
				status: 200,
			})
			.mockResponse({
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
			})
			.mockResponse({ status: 204 })
			.mockResponse({
				body: {
					developerProducts: [{ ...WIRE_BODY, description: "New config description" }],
					nextPageToken: JSON.parse("null"),
				},
				status: 200,
			});
		const subject = liveProductFixture(http);
		const options = {
			...subject.options,
			config: {
				...subject.options.config,
				products: {
					"gem-pack": {
						...subject.options.config.products["gem-pack"],
						description: "New config description",
					},
				},
			},
		};
		const result = await deploy(options);
		assert(result.success);
		const { body } = http.requests[2]!.request;
		assert(body instanceof FormData);

		expect(formFields(body)).toStrictEqual({
			name: "Gem Pack",
			description: "New config description",
			isForSale: "true",
			isManagedPricingEnabled: "false",
			price: "100",
		});
		expect(subject.store.states.get("production")!.resources).toStrictEqual([
			{ ...subject.current, description: "New config description" },
		]);
		expect(subject.events.filter(({ kind }) => kind === "resourceOpSucceeded")).toMatchObject([
			{ changedFields: ["description", "price"], opType: "update", reason: "outOfBandEdit" },
		]);

		subject.events.length = 0;
		const settled = await deploy(options);
		assert(settled.success);

		expect(http.requests.map(({ request }) => [request.method, request.url])).toStrictEqual([
			["GET", "/developer-products/v2/universes/123/developer-products/creator"],
			[
				"GET",
				"/developer-products/v2/universes/123/developer-products/creator?pageToken=next+products",
			],
			["PATCH", "/developer-products/v2/universes/123/developer-products/8172635495"],
			["GET", "/developer-products/v2/universes/123/developer-products/creator"],
		]);
		expect({
			events: subject.events.filter(({ kind }) => kind === "resourceOpNoop"),
			resources: settled.data.resources,
		}).toMatchObject({
			events: [{ key: "gem-pack", resourceKind: "developerProduct" }],
			resources: [{ ...subject.current, description: "New config description" }],
		});
	});

	it.for([deploy, provision])(
		"should leave an unchanged product as a noop with no upstream write during a required audit",
		async (run, { expect }) => {
			expect.hasAssertions();

			const subject = liveProductFixture(
				createFakeHttpClient().mockResponse({
					body: { developerProducts: [WIRE_BODY], nextPageToken: JSON.parse("null") },
					status: 200,
				}),
			);
			const result = await run({ ...subject.options, failOnOutOfBandEdit: true, live: true });
			assert(result.success);

			expect(subject.httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
				"GET",
			]);
			expect(subject.store.states.get("production")!.resources).toStrictEqual([
				subject.current,
			]);
			expect(subject.events.filter(({ kind }) => kind === "resourceOpStarted")).toBeEmpty();
			expect(subject.events).toContainEqual(
				expect.objectContaining({
					key: "gem-pack",
					kind: "resourceOpNoop",
					resourceKind: "developerProduct",
				}),
			);
			expect(subject.events.find(({ kind }) => kind === "liveCheck")).toMatchObject({
				check: { checkedKinds: ["developerProduct"], edits: [], missing: [] },
			});
		},
	);

	it("should honor an explicitly disabled product live check without upstream requests", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const subject = liveProductFixture();
		const result = await deploy({ ...subject.options, live: false });
		assert(result.success);

		expect(subject.httpClient.requests).toBeEmpty();
		expect(result.data.resources).toStrictEqual([subject.current]);

		const liveEvent = subject.events.find(({ kind }) => kind === "liveCheck");
		assert(liveEvent!.kind === "liveCheck");

		expect(liveEvent.check.checkedKinds).toStrictEqual([]);
		expect(liveEvent.check.skippedKinds).toContainEqual({
			kind: "developerProduct",
			reason: "disabled",
		});
	});

	it.for([deploy, provision])(
		"should refuse an audit of edited products before any upstream write or State write",
		async (run, { expect }) => {
			expect.hasAssertions();

			const subject = liveProductFixture(
				createFakeHttpClient().mockResponse({
					body: {
						developerProducts: [
							{
								...WIRE_BODY,
								name: "Dashboard gems",
								priceInformation: { defaultPriceInRobux: 120, enabledFeatures: [] },
							},
						],
						nextPageToken: JSON.parse("null"),
					},
					status: 200,
				}),
			);
			const result = await run({ ...subject.options, failOnOutOfBandEdit: true });

			expect(result).toMatchObject({
				err: {
					edits: [
						{
							key: "gem-pack",
							fields: [
								{ current: "Gem Pack", field: "name", live: "Dashboard gems" },
								{ current: 100, field: "price", live: 120 },
							],
							kind: "developerProduct",
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
			expect(subject.store.states.get("production")!.resources).toStrictEqual([
				subject.current,
			]);
			expect(subject.events.filter(({ kind }) => kind === "resourceOpStarted")).toBeEmpty();
		},
	);

	it.for([
		{ label: "first page", methods: ["GET"], pages: [] },
		{
			label: "later page",
			methods: ["GET", "GET"],
			pages: [
				{
					body: {
						developerProducts: [{ ...WIRE_BODY, name: "Dashboard gems" }],
						nextPageToken: "next",
					},
					status: 200,
				},
			],
		},
	])(
		"should stop safely on an incomplete product list before applying edits ($label)",
		async ({ methods, pages }, { expect }) => {
			expect.hasAssertions();

			const cause = new OpenCloudError("product list unavailable");
			const http = pages
				.reduce((client, page) => client.mockResponse(page), createFakeHttpClient())
				.mockError(cause);
			const subject = liveProductFixture(http);
			const result = await deploy(subject.options);

			expect(result).toStrictEqual({
				err: { cause, kind: "liveCheckFailed", resourceKind: "developerProduct" },
				success: false,
			});
			expect(http.requests.map(({ request }) => request.method)).toStrictEqual(methods);
			expect(subject.store.writes).toBeEmpty();
			expect(subject.store.states.get("production")!.resources).toStrictEqual([
				subject.current,
			]);
			expect(subject.events.filter(({ kind }) => kind === "resourceOpStarted")).toBeEmpty();
		},
	);

	it.for([
		{
			expectedPricing: { isForSale: "true", isManagedPricingEnabled: "false", price: "100" },
			field: "name",
			label: "name",
			savedManagedPricing: false,
			savedPrice: 100,
			wire: { name: "Dashboard gems" },
		},
		{
			expectedPricing: { isForSale: "true", isManagedPricingEnabled: "false", price: "100" },
			field: "description",
			label: "description",
			savedManagedPricing: false,
			savedPrice: 100,
			wire: { description: "Dashboard description" },
		},
		{
			expectedPricing: { isForSale: "true", isManagedPricingEnabled: "false", price: "100" },
			field: "price",
			label: "off-sale status with retained pricing",
			savedManagedPricing: false,
			savedPrice: 100,
			wire: { isForSale: false },
		},
		{
			expectedPricing: { isForSale: "false", isManagedPricingEnabled: "false" },
			field: "price",
			label: "on-sale status",
			savedManagedPricing: false,
			savedPrice: undefined,
			wire: { isForSale: true },
		},
		{
			expectedPricing: { isForSale: "true", isManagedPricingEnabled: "false", price: "100" },
			field: "isManagedPricingEnabled",
			label: "enabled managed pricing",
			savedManagedPricing: false,
			savedPrice: 100,
			wire: { isManagedPricingEnabled: true },
		},
		{
			expectedPricing: { isForSale: "true", isManagedPricingEnabled: "true", price: "100" },
			field: "isManagedPricingEnabled",
			label: "disabled managed pricing",
			savedManagedPricing: true,
			savedPrice: 100,
			wire: { isManagedPricingEnabled: false },
		},
	])(
		"should restore an external $label change with one full-field update",
		async ({ expectedPricing, field, savedManagedPricing, savedPrice, wire }, { expect }) => {
			expect.hasAssertions();

			const http = createFakeHttpClient()
				.mockResponse({
					body: {
						developerProducts: [{ ...WIRE_BODY, ...wire }],
						nextPageToken: JSON.parse("null"),
					},
					status: 200,
				})
				.mockResponse({ status: 204 });
			const subject = liveProductFixture(
				http,
				liveProductCurrent({
					isManagedPricingEnabled: savedManagedPricing,
					price: savedPrice,
				}),
			);
			const result = await deploy(subject.options);
			assert(result.success);
			const { body } = http.requests[1]!.request;
			assert(body instanceof FormData);

			expect(formFields(body)).toStrictEqual({
				name: "Gem Pack",
				description: "Stocks the player up with 1,000 premium gems.",
				...expectedPricing,
			});
			expect(http.requests.map(({ request }) => request.method)).toStrictEqual([
				"GET",
				"PATCH",
			]);
			expect(subject.store.states.get("production")!.resources).toStrictEqual([
				subject.current,
			]);
			expect(
				subject.events.filter(({ kind }) => {
					return ["resourceOpStarted", "resourceOpSucceeded"].includes(kind);
				}),
			).toMatchObject([
				{
					kind: "resourceOpStarted",
					opType: "update",
					reason: "outOfBandEdit",
					resourceKind: "developerProduct",
				},
				{
					changedFields: [field],
					kind: "resourceOpSucceeded",
					opType: "update",
					reason: "outOfBandEdit",
					resourceKind: "developerProduct",
				},
			]);
			expect(subject.events).toContainEqual(
				expect.objectContaining({ kind: "applySummary", reverted: 1, updated: 1 }),
			);
		},
	);

	it.for([deploy, provision])(
		"should restore a product price, preserve its local icon hashes and settle to a noop on the next run",
		async (run, { expect }) => {
			expect.hasAssertions();

			const http = createFakeHttpClient()
				.mockResponse({
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
				})
				.mockResponse({ status: 204 })
				.mockResponse({
					body: { developerProducts: [WIRE_BODY], nextPageToken: JSON.parse("null") },
					status: 200,
				});
			const subject = liveProductFixture(http);
			const reverted = await run(subject.options);
			assert(reverted.success);

			expect(subject.store.states.get("production")!.resources).toStrictEqual([
				subject.current,
			]);
			expect(subject.events).toContainEqual(
				expect.objectContaining({ kind: "applySummary", reverted: 1, updated: 1 }),
			);

			subject.events.length = 0;
			const settled = await run(subject.options);
			assert(settled.success);

			expect(http.requests.map(({ request }) => [request.method, request.url])).toStrictEqual(
				[
					["GET", "/developer-products/v2/universes/123/developer-products/creator"],
					["PATCH", "/developer-products/v2/universes/123/developer-products/8172635495"],
					["GET", "/developer-products/v2/universes/123/developer-products/creator"],
				],
			);

			const { body } = http.requests[1]!.request;
			assert(body instanceof FormData);

			expect(formFields(body)).toStrictEqual({
				name: "Gem Pack",
				description: "Stocks the player up with 1,000 premium gems.",
				isForSale: "true",
				isManagedPricingEnabled: "false",
				price: "100",
			});
			expect({
				events: subject.events.filter(({ kind }) => kind === "resourceOpNoop"),
				resources: settled.data.resources,
			}).toMatchObject({
				events: [{ key: "gem-pack", resourceKind: "developerProduct" }],
				resources: [subject.current],
			});
		},
	);
});
