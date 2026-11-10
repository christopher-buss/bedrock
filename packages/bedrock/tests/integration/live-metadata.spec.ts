import { asRobloxAssetId, createPlaceDriver, createUniverseDriver } from "@bedrock-rbx/core";
import { ApiError, OpenCloudError } from "@bedrock-rbx/ocale";
import { PlacesClient } from "@bedrock-rbx/ocale/places";
import { createFakeHttpClient, validUniverseBody } from "@bedrock-rbx/ocale/testing";
import { UniversesClient } from "@bedrock-rbx/ocale/universes";

import { assert, describe, it } from "vitest";

import { SOCIAL_LINK_FIELDS, UNIVERSE_MANAGED_FLAGS } from "#src/core/resources";
import type { ResourceCurrentState } from "#src/core/resources";
import { previewDiffAsync } from "#src/shell/preview-diff";
import { universeCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

function metadataRegistry(httpClient: ReturnType<typeof createFakeHttpClient>) {
	const options = {
		credential: { apiKey: "fake", kind: "apiKey" } as const,
		httpClient,
		sleep: async () => {},
	};
	const places = new PlacesClient(options);
	return {
		place: createPlaceDriver({
			client: places,
			readFile: async () => {
				throw new Error("live metadata must never read a place file");
			},
			universeId: asRobloxAssetId("1234567890"),
		}),
		universe: createUniverseDriver({ places, universes: new UniversesClient(options) }),
	};
}

function universePreview(
	httpClient: ReturnType<typeof createFakeHttpClient>,
	current: ResourceCurrentState<"universe">,
) {
	const { key: _key, kind: _kind, outputs: _outputs, ...entry } = current;
	const store = fakeStateStore({
		initial: { production: { environment: "production", resources: [current], version: 1 } },
	});
	return {
		options: {
			config: {
				environments: { production: {} },
				universe: {
					...Object.fromEntries(
						Object.entries(entry).filter(([, value]) => value !== undefined),
					),
					universeId: current.universeId,
				},
			},
			environment: "production",
			registry: metadataRegistry(httpClient),
			statePort: store.port,
		},
		store,
	};
}

describe("universe and place live metadata", () => {
	it.for(UNIVERSE_MANAGED_FLAGS)(
		"should report a managed universe %s edit",
		async (field, { expect }) => {
			expect.hasAssertions();

			const fixture = universePreview(
				createFakeHttpClient().mockResponse({
					body: validUniverseBody({ [field]: false }),
					status: 200,
				}),
				universeCurrent({ [field]: true }),
			);
			const result = await previewDiffAsync(fixture.options);
			assert(result.success);

			expect(result.data.liveCheck!.edits).toStrictEqual([
				{ key: "main", fields: [{ current: true, field, live: false }], kind: "universe" },
			]);
		},
	);

	it.for(SOCIAL_LINK_FIELDS)(
		"should report a removed managed universe %s",
		async (field, { expect }) => {
			expect.hasAssertions();

			const saved = { title: "Community", uri: "https://example.com/community" };
			const fixture = universePreview(
				createFakeHttpClient().mockResponse({ body: validUniverseBody(), status: 200 }),
				universeCurrent({ [field]: saved }),
			);
			const result = await previewDiffAsync(fixture.options);
			assert(result.success);

			expect(result.data.liveCheck!.edits).toStrictEqual([
				{
					key: "main",
					fields: [{ current: saved, field, live: undefined }],
					kind: "universe",
				},
			]);
		},
	);

	it("should report universe display name, visibility and disabled private servers", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = universePreview(
			createFakeHttpClient().mockResponse({ body: validUniverseBody(), status: 200 }),
			universeCurrent({
				displayName: "Saved title",
				privateServerPriceRobux: 100,
				visibility: "private",
			}),
		);
		const result = await previewDiffAsync(fixture.options);
		assert(result.success);

		expect(result.data.liveCheck!.edits).toStrictEqual([
			{
				key: "main",
				fields: [
					{ current: "private", field: "visibility", live: "public" },
					{ current: "Saved title", field: "displayName", live: "Test Universe" },
					{ current: 100, field: "privateServerPriceRobux", live: undefined },
				],
				kind: "universe",
			},
		]);
	});

	it("should ignore unmanaged universe settings", async ({ expect }) => {
		expect.hasAssertions();

		const fixture = universePreview(
			createFakeHttpClient().mockResponse({
				body: validUniverseBody({
					desktopEnabled: false,
					discordSocialLink: { title: "New", uri: "https://example.com" },
					privateServerPriceRobux: 100,
				}),
				status: 200,
			}),
			universeCurrent(),
		);
		const result = await previewDiffAsync(fixture.options);
		assert(result.success);

		expect(result.data.liveCheck!.edits).toStrictEqual([]);
		expect(result.data.ops).toStrictEqual([{ key: "main", kind: "universe", type: "noop" }]);
	});

	it("should fail the preview when a tracked universe cannot be read", async ({ expect }) => {
		expect.hasAssertions();

		const cause = new OpenCloudError("read refused");
		const fixture = universePreview(createFakeHttpClient().mockError(cause), universeCurrent());
		const result = await previewDiffAsync(fixture.options);

		expect(result).toStrictEqual({
			err: { cause, kind: "liveCheckFailed", resourceKind: "universe" },
			success: false,
		});
		expect(fixture.store.writes).toBeEmpty();
	});

	it("should report a missing universe and retain its saved baseline", async ({ expect }) => {
		expect.hasAssertions();

		const fixture = universePreview(
			createFakeHttpClient().mockError(new ApiError("Not found", { statusCode: 404 })),
			universeCurrent({ desktopEnabled: true }),
		);
		const result = await previewDiffAsync(fixture.options);
		assert(result.success);

		expect(result.data.liveCheck!.missing).toStrictEqual([
			{ key: "main", kind: "universe", robloxId: "1234567890" },
		]);
		expect(result.data.ops).toStrictEqual([{ key: "main", kind: "universe", type: "noop" }]);
	});

	it("should retain managed visibility when Roblox cannot classify it", async ({ expect }) => {
		expect.hasAssertions();

		const fixture = universePreview(
			createFakeHttpClient().mockResponse({
				body: validUniverseBody({ visibility: "VISIBILITY_UNSPECIFIED" }),
				status: 200,
			}),
			universeCurrent({ visibility: "private" }),
		);
		const result = await previewDiffAsync(fixture.options);
		assert(result.success);

		expect(result.data.liveCheck!.edits).toStrictEqual([]);
		expect(result.data.ops).toStrictEqual([{ key: "main", kind: "universe", type: "noop" }]);
	});

	it("should fail the preview for an API refusal other than a missing universe", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const cause = new ApiError("Forbidden", { statusCode: 403 });
		const fixture = universePreview(createFakeHttpClient().mockError(cause), universeCurrent());

		await expect(previewDiffAsync(fixture.options)).resolves.toStrictEqual({
			err: { cause, kind: "liveCheckFailed", resourceKind: "universe" },
			success: false,
		});
	});

	it("should preview a managed universe setting edit independently of ordinary Drift", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const current = universeCurrent({ desktopEnabled: true });
		const store = fakeStateStore({
			initial: {
				production: { environment: "production", resources: [current], version: 1 },
			},
		});
		const httpClient = createFakeHttpClient().mockResponse({
			body: validUniverseBody({ desktopEnabled: false }),
			status: 200,
		});
		const result = await previewDiffAsync({
			config: {
				environments: { production: {} },
				universe: { desktopEnabled: true, universeId: "1234567890" },
			},
			environment: "production",
			registry: metadataRegistry(httpClient),
			statePort: store.port,
		});
		assert(result.success);

		expect(result.data.liveCheck).toMatchObject({
			checkedKinds: ["universe"],
			edits: [
				{
					key: "main",
					fields: [{ current: true, field: "desktopEnabled", live: false }],
					kind: "universe",
				},
			],
			missing: [],
			skippedKinds: [
				{ kind: "badge", reason: "unsupported" },
				{ kind: "developerProduct", reason: "unsupported" },
				{ kind: "gamePass", reason: "unsupported" },
				{ kind: "place", reason: "unsupported" },
			],
		});
		expect(result.data.drift).toStrictEqual([{ key: "main", kind: "universe", type: "noop" }]);
		expect(result.data.ops).toMatchObject([
			{
				current: { desktopEnabled: false },
				desired: { desktopEnabled: true },
				type: "update",
			},
		]);
		expect(
			httpClient.requests.map(({ request }) => [request.method, request.url]),
		).toStrictEqual([["GET", "/cloud/v2/universes/1234567890"]]);
		expect(store.writes).toBeEmpty();
	});
});
