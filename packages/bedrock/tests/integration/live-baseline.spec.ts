import { asResourceKey, asRobloxAssetId, deploy, provision, publish } from "@bedrock-rbx/core";
import { createFakeHttpClient, validGamePassBody } from "@bedrock-rbx/ocale/testing";

import { assert, describe, it } from "vitest";

import { livePassFixture } from "#tests/helpers/live-game-pass";
import { gamePassCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

const current = gamePassCurrent();
function passPage(price: number) {
	return {
		gamePasses: [
			validGamePassBody({
				name: current.name,
				description: current.description,
				gamePassId: 9_876_543_210,
				iconAssetId: 1_122_334_455,
				priceInformation: { defaultPriceInRobux: price, enabledFeatures: [] },
			}),
		],
		// eslint-disable-next-line unicorn/no-null -- Terminal Roblox list page.
		nextPageToken: null,
	};
}

describe("live reconciliation saved baselines", () => {
	it("should settle successes and selected live noops while retaining a failed resource", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const failed = gamePassCurrent({
			key: asResourceKey("failed"),
			outputs: { ...current.outputs, assetId: asRobloxAssetId("2") },
			price: 700,
		});
		const adopted = gamePassCurrent({
			key: asResourceKey("adopted"),
			outputs: { ...current.outputs, assetId: asRobloxAssetId("3") },
		});
		const page = passPage(120);
		const http = createFakeHttpClient()
			.mockResponse({
				body: {
					...page,
					gamePasses: [
						...page.gamePasses,
						...[2, 3].map((gamePassId) => {
							return validGamePassBody({ ...page.gamePasses[0]!, gamePassId });
						}),
					],
				},
				status: 200,
			})
			.mockResponse({ status: 204 })
			.mockApiError({ message: "refused", statusCode: 403 });
		const subject = livePassFixture(120, http);
		const store = fakeStateStore({
			initial: {
				production: {
					environment: "production",
					resources: [current, failed, adopted],
					version: 1,
				},
			},
		});
		const result = await deploy({
			...subject.options,
			config: {
				...subject.options.config,
				passes: {
					...subject.options.config.passes,
					adopted: { ...subject.options.config.passes["vip-pass"], price: 120 },
					failed: { ...subject.options.config.passes["vip-pass"], price: 700 },
				},
			},
			statePort: store.port,
		});

		expect(result).toMatchObject({ err: { kind: "applyFailed" }, success: false });
		expect(store.states.get("production")!.resources).toMatchObject([
			{ key: "vip-pass", price: 500 },
			{ key: "failed", price: 700 },
			{ key: "adopted", price: 120 },
		]);
		expect(http.requests.map(({ request }) => request.method)).toStrictEqual([
			"GET",
			"PATCH",
			"PATCH",
		]);
	});

	it("should keep failed revert values in the unsaved snapshot when persistence also fails", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse({ body: passPage(120), status: 200 })
			.mockApiError({ message: "refused", statusCode: 403 });
		const subject = livePassFixture(120, http);
		const store = fakeStateStore({
			initial: { production: subject.store.states.get("production")! },
			refuseWrite: {
				production: { file: "production", kind: "stateError", reason: "unavailable" },
			},
		});
		const result = await deploy({ ...subject.options, statePort: store.port });

		expect(result).toMatchObject({
			err: {
				applyFailure: { failures: [{ kind: "driverFailure" }] },
				kind: "stateWriteFailed",
				unsavedState: { resources: [{ price: 500 }] },
			},
			success: false,
		});
		expect(store.states.get("production")!.resources).toStrictEqual([subject.current]);
	});

	it("should retain an unapplied pass edit through publish so the next audit refuses", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse({ body: passPage(120), status: 200 })
			.mockResponse({ body: passPage(120), status: 200 });
		const subject = livePassFixture(120, http);
		const published = await publish(subject.options);
		assert(published.success);

		expect(subject.store.states.get("production")!.resources).toMatchObject([{ price: 500 }]);

		const audited = await provision({ ...subject.options, failOnOutOfBandEdit: true });

		expect(audited).toMatchObject({ err: { kind: "outOfBandEdits" }, success: false });
		expect(http.requests.map(({ request }) => request.method)).toStrictEqual(["GET", "GET"]);
	});

	it("should retain a failed scalar revert for audit and a labelled retry", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse({ body: passPage(120), status: 200 })
			.mockApiError({ message: "refused", statusCode: 403 })
			.mockResponse({ body: passPage(120), status: 200 })
			.mockResponse({ body: passPage(120), status: 200 })
			.mockResponse({ status: 204 })
			.mockResponse({ body: passPage(500), status: 200 });
		const subject = livePassFixture(120, http);
		const failed = await deploy(subject.options);

		expect(failed).toMatchObject({ err: { kind: "applyFailed" }, success: false });
		expect(subject.store.states.get("production")!.resources).toMatchObject([{ price: 500 }]);

		const audited = await provision({ ...subject.options, failOnOutOfBandEdit: true });

		expect(audited).toMatchObject({ err: { kind: "outOfBandEdits" }, success: false });

		const retried = await deploy(subject.options);
		assert(retried.success);

		expect(subject.events).toContainEqual(
			expect.objectContaining({ kind: "resourceOpSucceeded", reason: "outOfBandEdit" }),
		);

		const settled = await deploy(subject.options);
		assert(settled.success);

		expect(http.requests.map(({ request }) => request.method)).toStrictEqual([
			"GET",
			"PATCH",
			"GET",
			"GET",
			"PATCH",
			"GET",
		]);
	});
});
