import { deploy } from "@bedrock-rbx/core";
import { createFakeHttpClient } from "@bedrock-rbx/ocale/testing";

import { assert, describe, it } from "vitest";

import { previewDiffAsync } from "#src/shell/preview-diff";
import {
	ICON_CASES,
	iconConfig,
	iconCurrent,
	iconId,
	iconPage,
	iconUpdate,
	liveIconFixture,
} from "#tests/helpers/live-icon";

describe("replaced local icons", () => {
	it.for(ICON_CASES)(
		"should leave an unchanged $kind icon alone",
		async ({ kind }, { expect }) => {
			expect.hasAssertions();

			const current = iconCurrent(kind);
			const httpClient = createFakeHttpClient().mockResponse({
				body: iconPage(current, { id: Number(iconId(current)) }),
				status: 200,
			});
			const fixture = liveIconFixture(kind, { httpClient });
			const result = await deploy(fixture.options);
			assert(result.success);

			expect({
				methods: httpClient.requests.map(({ request }) => request.method),
				resources: result.data.resources,
			}).toStrictEqual({ methods: ["GET"], resources: [current] });
			expect(fixture.events.filter((event) => event.kind === "liveCheck")).toMatchObject([
				{ check: { edits: [] } },
			]);
		},
	);

	it.for(ICON_CASES)(
		"should refuse a $kind icon audit before uploads and State writes",
		async ({ kind }, { expect }) => {
			expect.hasAssertions();

			const current = iconCurrent(kind);
			const httpClient = createFakeHttpClient().mockResponse({
				body: iconPage(current, { id: 99 }),
				status: 200,
			});
			const fixture = liveIconFixture(kind, { httpClient });
			const result = await deploy({ ...fixture.options, failOnOutOfBandEdit: true });

			expect(result).toMatchObject({
				err: {
					edits: [{ fields: [{ current: iconId(current), field: "icon", live: "99" }] }],
					kind: "outOfBandEdits",
				},
				success: false,
			});
			expect(httpClient.requests.map(({ request }) => request.method)).toStrictEqual(["GET"]);
			expect(fixture.store.writes).toStrictEqual([]);
			expect(fixture.store.states.get("production")!.resources).toStrictEqual([current]);
		},
	);

	it.for(ICON_CASES)(
		"should use saved $kind icons without requests when live checks are disabled",
		async ({ kind }, { expect }) => {
			expect.hasAssertions();

			const fixture = liveIconFixture(kind);
			const result = await deploy({ ...fixture.options, live: false });
			assert(result.success);

			expect(fixture.httpClient.requests).toStrictEqual([]);
			expect(result.data.resources).toStrictEqual([fixture.current]);
			expect(
				fixture.events.filter((event) => event.kind === "resourceOpSucceeded"),
			).toStrictEqual([]);
		},
	);

	it.for(ICON_CASES)(
		"should combine a $kind icon replacement and reviewed config change in one update",
		async ({ kind, methods }, { expect }) => {
			expect.hasAssertions();

			const current = iconCurrent(kind);
			const httpClient = iconUpdate(
				createFakeHttpClient().mockResponse({
					body: iconPage(current, { id: 99 }),
					status: 200,
				}),
				{ current, description: "Reviewed description" },
			).mockResponse({
				body: iconPage(current, { id: 777, description: "Reviewed description" }),
				status: 200,
			});
			const fixture = liveIconFixture(kind, { httpClient });
			const options = {
				...fixture.options,
				config: iconConfig(current, "Reviewed description"),
			};
			const result = await deploy(options);
			assert(result.success);
			const settled = await deploy(options);
			assert(settled.success);

			expect(httpClient.requests.map(({ request }) => request.method)).toStrictEqual(methods);
			expect(result.data.resources).toMatchObject([
				{ description: "Reviewed description", iconFileHashes: current.iconFileHashes },
			]);
			expect(
				fixture.events.filter((event) => event.kind === "resourceOpSucceeded"),
			).toMatchObject([{ changedFields: ["description", "icon"], reason: "outOfBandEdit" }]);
			expect(settled.data.resources).toStrictEqual(result.data.resources);
		},
	);

	it.for(ICON_CASES)(
		"should restore a readable absent $kind icon",
		async ({ kind }, { expect }) => {
			expect.hasAssertions();

			const current = iconCurrent(kind);
			const httpClient = iconUpdate(
				createFakeHttpClient().mockResponse({
					body: iconPage(current, { id: undefined }),
					status: 200,
				}),
				{ current },
			);
			const fixture = liveIconFixture(kind, { httpClient });
			const result = await deploy(fixture.options);
			assert(result.success, JSON.stringify(result));

			expect(iconId(result.data.resources[0]!)).toBe("777");
			expect(fixture.events.filter((event) => event.kind === "liveCheck")).toMatchObject([
				{
					check: {
						edits: [
							{
								fields: [
									{ current: iconId(current), field: "icon", live: undefined },
								],
							},
						],
					},
				},
			]);
		},
	);

	it.for(ICON_CASES)(
		"should preview an icon-only $kind replacement as a revert update without config drift",
		async ({ kind }, { expect }) => {
			expect.hasAssertions();

			const current = iconCurrent(kind);
			const fixture = liveIconFixture(kind, {
				httpClient: createFakeHttpClient().mockResponse({
					body: iconPage(current, { id: 99 }),
					status: 200,
				}),
			});
			const result = await previewDiffAsync(fixture.options);
			assert(result.success, JSON.stringify(result));

			expect(result.data.liveCheck!.edits).toStrictEqual([
				{
					key: current.key,
					fields: [{ current: iconId(current), field: "icon", live: "99" }],
					kind,
				},
			]);
			expect(result.data.drift).toStrictEqual([{ key: current.key, kind, type: "noop" }]);
			expect(result.data.ops).toMatchObject([
				{
					key: current.key,
					changedFields: ["icon"],
					desired: { iconFileHashes: current.iconFileHashes },
					forceIconUpload: true,
					reason: "outOfBandEdit",
					type: "update",
				},
			]);
			expect(fixture.httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
				"GET",
			]);
			expect(fixture.store.writes).toStrictEqual([]);
		},
	);

	it.for(ICON_CASES)(
		"should restore a $kind icon once, persist its new ID and true hash, and settle to a noop",
		async ({ field, kind, methods, uploadIndex }, { expect }) => {
			expect.hasAssertions();

			const current = iconCurrent(kind);
			const http = iconUpdate(
				createFakeHttpClient().mockResponse({
					body: iconPage(current, { id: 99 }),
					status: 200,
				}),
				{ current },
			).mockResponse({ body: iconPage(current, { id: 777 }), status: 200 });
			const fixture = liveIconFixture(kind, { httpClient: http });
			const first = await deploy(fixture.options);
			assert(first.success, JSON.stringify(first));
			const restored = fixture.store.states.get("production")!.resources[0]!;
			assert("iconFileHashes" in restored);

			expect({
				id: iconId(restored),
				forcePersisted: "forceIconUpload" in restored,
				hashes: restored.iconFileHashes,
			}).toStrictEqual({
				id: "777",
				forcePersisted: false,
				hashes: current.iconFileHashes,
			});

			const second = await deploy(fixture.options);
			assert(second.success, JSON.stringify(second));

			expect(second.data.resources).toStrictEqual(first.data.resources);
			expect({
				succeeded: fixture.events.filter((event) => event.kind === "resourceOpSucceeded"),
				summaries: fixture.events.filter((event) => event.kind === "applySummary"),
			}).toMatchObject({
				succeeded: [{ changedFields: ["icon"], opType: "update", reason: "outOfBandEdit" }],
				summaries: [
					{ reverted: 1, updated: 1 },
					{ noop: 1, updated: 0 },
				],
			});
			expect(http.requests.map(({ request }) => request.method)).toStrictEqual(methods);

			const upload = http.requests[uploadIndex]!.request.body;
			assert(upload instanceof FormData);
			const file = upload.get(field);
			assert(file instanceof Blob);

			expect(new Uint8Array(await file.arrayBuffer())).toStrictEqual(new Uint8Array());
		},
	);
});
