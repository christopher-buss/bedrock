import { deploy } from "@bedrock-rbx/core";
import {
	ApiError,
	NetworkError,
	type OpenCloudError,
	RequestDeadlineExceededError,
	UnexpectedResponseError,
} from "@bedrock-rbx/ocale";
import { createFakeHttpClient, validGamePassBody } from "@bedrock-rbx/ocale/testing";

import { assert, describe, it } from "vitest";

import { livePassFixture } from "#tests/helpers/live-game-pass";
import { gamePassCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

const PASS = gamePassCurrent();

function passList(...ids: ReadonlyArray<number>): { body: unknown; status: number } {
	return {
		body: {
			gamePasses: ids.map((gamePassId) => {
				return validGamePassBody({
					name: PASS.name,
					description: PASS.description,
					gamePassId,
					iconAssetId: 1_122_334_455,
					priceInformation: { defaultPriceInRobux: 500, enabledFeatures: [] },
				});
			}),
			nextPageToken: JSON.parse("null"),
		},
		status: 200,
	};
}

describe("create recovery", () => {
	it("should record a game pass that Roblox created behind a 5xx and settle on the next run", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse(passList())
			.mockApiError({ statusCode: 503 })
			.mockResponse(passList(9_876_543_210))
			.mockResponse(passList(9_876_543_210));
		const subject = livePassFixture(500, http);
		const store = fakeStateStore();
		const options = { ...subject.options, statePort: store.port };

		const result = await deploy(options);
		assert(result.success);

		expect(store.states.get("production")!.resources).toStrictEqual([
			{ ...PASS, isManagedPricingEnabled: false },
		]);
		expect(subject.events.filter(({ kind }) => kind === "createRecovered")).toMatchObject([
			{
				key: "vip-pass",
				environment: "production",
				resourceKind: "gamePass",
				robloxId: "9876543210",
			},
		]);

		subject.events.length = 0;
		const settled = await deploy(options);
		assert(settled.success);

		expect(subject.events.filter(({ kind }) => kind === "resourceOpNoop")).toMatchObject([
			{ key: "vip-pass" },
		]);
		expect(http.pendingMocks).toBe(0);
	});

	it.for([
		["no new pass", passList()],
		["two new passes", passList(9_876_543_210, 2)],
	] as const)(
		"should fail as before and record nothing when the second list shows %s",
		async ([, relisted], { expect }) => {
			expect.hasAssertions();

			const http = createFakeHttpClient()
				.mockResponse(passList())
				.mockApiError({ statusCode: 503 })
				.mockResponse(relisted);
			const subject = livePassFixture(500, http);
			const store = fakeStateStore();
			const result = await deploy({ ...subject.options, statePort: store.port });
			assert(!result.success);

			expect(result.err).toMatchObject({
				cause: { failures: [{ key: "vip-pass", cause: { statusCode: 503 } }] },
				kind: "applyFailed",
			});
			expect(store.states.get("production")!.resources).toStrictEqual([]);
			expect(subject.events.map(({ kind }) => kind)).not.toContain("createRecovered");
		},
	);

	it("should not list again after a 4xx create failure", async ({ expect }) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse(passList())
			.mockApiError({ statusCode: 400 })
			.mockResponse(passList(9_876_543_210));
		const subject = livePassFixture(500, http);
		const result = await deploy({ ...subject.options, statePort: fakeStateStore().port });
		assert(!result.success);

		expect(http.pendingMocks).toBe(1);
		expect(subject.events.map(({ kind }) => kind)).not.toContain("createRecovered");
	});

	it("should not list again after a failure that is neither a 5xx, a network failure nor a timeout", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse(passList())
			.mockError(
				new UnexpectedResponseError("Malformed game pass response", { statusCode: 200 }),
			)
			.mockResponse(passList(9_876_543_210));
		const subject = livePassFixture(500, http);
		const result = await deploy({ ...subject.options, statePort: fakeStateStore().port });
		assert(!result.success);

		expect(http.pendingMocks).toBe(1);
	});

	it("should return the create failure when the second list fails", async ({ expect }) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse(passList())
			.mockApiError({ statusCode: 503 })
			.mockApiError({ statusCode: 403 });
		const subject = livePassFixture(500, http);
		const result = await deploy({ ...subject.options, statePort: fakeStateStore().port });
		assert(!result.success);

		expect(result.err).toMatchObject({
			cause: { failures: [{ cause: { statusCode: 503 } }] },
		});
	});

	it.for<[string, OpenCloudError]>([
		["a 500", new ApiError("Internal server error", { statusCode: 500 })],
		["a network failure", new NetworkError("Network request failed")],
		[
			"a timeout",
			new RequestDeadlineExceededError("Request deadline elapsed", {
				deadlineMs: 0,
				remainingMs: 0,
			}),
		],
	])("should recover a create that failed with %s", async ([, failure], { expect }) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse(passList())
			.mockError(failure)
			.mockResponse(passList(9_876_543_210));
		const subject = livePassFixture(500, http);
		const result = await deploy({ ...subject.options, statePort: fakeStateStore().port });
		assert(result.success);

		expect(subject.events.filter(({ kind }) => kind === "createRecovered")).toMatchObject([
			{ cause: failure },
		]);
	});

	it("should not recover a create when the live check is off", async ({ expect }) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockApiError({ statusCode: 503 })
			.mockResponse(passList(9_876_543_210));
		const subject = livePassFixture(500, http);
		const result = await deploy({
			...subject.options,
			live: false,
			statePort: fakeStateStore().port,
		});
		assert(!result.success);

		expect(http.pendingMocks).toBe(1);
		expect(
			subject.events.filter(({ kind }) => kind === "createRecoveryUnavailable"),
		).toMatchObject([
			{
				key: "vip-pass",
				cause: { statusCode: 503 },
				environment: "production",
				resourceKind: "gamePass",
			},
		]);
	});

	it("should not say recovery needs the live check after a failure it would not recover", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient().mockApiError({ statusCode: 400 });
		const subject = livePassFixture(500, http);
		const result = await deploy({
			...subject.options,
			live: false,
			statePort: fakeStateStore().port,
		});
		assert(!result.success);

		expect(subject.events.map(({ kind }) => kind)).not.toContain("createRecoveryUnavailable");
	});
});
