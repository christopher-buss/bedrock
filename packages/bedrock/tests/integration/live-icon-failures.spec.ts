import { deploy } from "@bedrock-rbx/core";
import { OpenCloudError } from "@bedrock-rbx/ocale";
import { createFakeHttpClient } from "@bedrock-rbx/ocale/testing";

import { assert, describe, it } from "vitest";

import {
	ICON_CASES,
	iconCurrent,
	iconId,
	iconPage,
	iconUpdate,
	iconWire,
	liveIconFixture,
} from "#tests/helpers/live-icon";
import { fakeStateStore } from "#tests/helpers/state-store";

const MISSING_ID_CASES = [
	{
		kind: "gamePass",
		message: "Malformed game pass response: iconAssetId missing after icon upload",
	},
	{
		kind: "developerProduct",
		message: "Malformed developer product response: iconImageAssetId missing after icon upload",
	},
] as const;

describe("icon restoration failures", () => {
	it.for(ICON_CASES)(
		"should retain the saved $kind icon baseline after a failed upload and retry restoration",
		async ({ kind, uploadIndex }, { expect }) => {
			expect.hasAssertions();

			const current = iconCurrent(kind);
			const httpClient = Array.from({ length: uploadIndex - 1 })
				.reduce(
					(http) => http.mockResponse({ status: 200 }),
					createFakeHttpClient().mockResponse({
						body: iconPage(current, { id: 99 }),
						status: 200,
					}),
				)
				.mockError(new OpenCloudError("icon upload refused"));
			const fixture = liveIconFixture(kind, { httpClient });
			const failed = await deploy(fixture.options);

			expect(failed).toMatchObject({ err: { kind: "applyFailed" }, success: false });
			expect(iconId(fixture.store.states.get("production")!.resources[0]!)).toBe(
				iconId(current),
			);

			iconUpdate(
				httpClient.mockResponse({ body: iconPage(current, { id: 99 }), status: 200 }),
				{ current },
			);
			const retry = await deploy(fixture.options);
			assert(retry.success, JSON.stringify(retry));

			expect(iconId(retry.data.resources[0]!)).toBe("777");
			expect(
				fixture.events.filter((event) => event.kind === "resourceOpFailed"),
			).toMatchObject([{ reason: "outOfBandEdit" }]);
		},
	);

	it.for(ICON_CASES.slice(0, 2))(
		"should retain the saved $kind icon ID after a failed follow-up read and retry",
		async ({ kind }, { expect }) => {
			expect.hasAssertions();

			const current = iconCurrent(kind);
			const httpClient = createFakeHttpClient()
				.mockResponse({ body: iconPage(current, { id: 99 }), status: 200 })
				.mockResponse({ status: 204 })
				.mockError(new OpenCloudError("icon ID read refused"));
			const fixture = liveIconFixture(kind, { httpClient });
			const failed = await deploy(fixture.options);

			expect(failed).toMatchObject({ err: { kind: "applyFailed" }, success: false });
			expect(iconId(fixture.store.states.get("production")!.resources[0]!)).toBe(
				iconId(current),
			);

			iconUpdate(
				httpClient.mockResponse({ body: iconPage(current, { id: 555 }), status: 200 }),
				{ current },
			);
			const retry = await deploy(fixture.options);
			assert(retry.success, JSON.stringify(retry));

			expect(iconId(retry.data.resources[0]!)).toBe("777");
			expect(fixture.events.filter((event) => event.kind === "applySummary")).toMatchObject([
				{ failed: 1, updated: 0 },
				{ reverted: 1, updated: 1 },
			]);
		},
	);

	it.for(MISSING_ID_CASES)(
		"should reject a $kind upload whose follow-up response has no icon ID",
		async ({ kind, message }, { expect }) => {
			expect.hasAssertions();

			const current = iconCurrent(kind);
			const httpClient = createFakeHttpClient()
				.mockResponse({ body: iconPage(current, { id: 99 }), status: 200 })
				.mockResponse({ status: 204 })
				.mockResponse({ body: iconWire(current, { id: undefined }), status: 200 });
			const fixture = liveIconFixture(kind, { httpClient });
			const failed = await deploy(fixture.options);

			expect(failed).toMatchObject({
				err: {
					cause: { failures: [{ cause: { message }, kind: "driverFailure" }] },
					kind: "applyFailed",
				},
				success: false,
			});
			expect(iconId(fixture.store.states.get("production")!.resources[0]!)).toBe(
				iconId(current),
			);
			expect(fixture.events.filter((event) => event.kind === "applySummary")).toMatchObject([
				{ failed: 1, updated: 0 },
			]);
			expect(
				fixture.events.filter((event) => event.kind === "resourceOpSucceeded"),
			).toStrictEqual([]);
		},
	);

	it.for(ICON_CASES)(
		"should return the restored $kind ID and true hash in an unsaved snapshot when State refuses the write",
		async ({ kind }, { expect }) => {
			expect.hasAssertions();

			const current = iconCurrent(kind);
			const fixture = liveIconFixture(kind, {
				httpClient: iconUpdate(
					createFakeHttpClient().mockResponse({
						body: iconPage(current, { id: 99 }),
						status: 200,
					}),
					{ current },
				),
			});
			const store = fakeStateStore({
				initial: { production: fixture.store.states.get("production")! },
				refuseWrite: {
					production: {
						file: "production.json",
						kind: "stateError",
						reason: "unavailable",
					},
				},
			});
			const result = await deploy({ ...fixture.options, statePort: store.port });
			assert(!result.success);
			assert(result.err.kind === "stateWriteFailed");

			expect(iconId(result.err.unsavedState.resources[0]!)).toBe("777");
			expect(result.err.unsavedState.resources[0]).toMatchObject({
				iconFileHashes: current.iconFileHashes,
			});
			expect(store.states.get("production")!.resources).toStrictEqual([current]);
		},
	);
});
