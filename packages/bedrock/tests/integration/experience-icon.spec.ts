import { asRobloxAssetId, asSha256Hex, createUniverseDriver, deploy } from "@bedrock-rbx/core";
import { AssetsClient } from "@bedrock-rbx/ocale/assets";
import { PlacesClient } from "@bedrock-rbx/ocale/places";
import {
	createFakeHttpClient,
	validPlaceBody,
	validUniverseBody,
} from "@bedrock-rbx/ocale/testing";
import { UniversesClient } from "@bedrock-rbx/ocale/universes";

import { createHash } from "node:crypto";
import { assert, describe, it } from "vitest";

import { none } from "#src/core/none";
import type { ResourceCurrentState } from "#src/core/resources";
import type { Config } from "#src/core/schema";
import type { ProgressEvent } from "#src/ports/progress-port";
import type { DriverRegistry } from "#src/ports/resource-driver";
import { BADGE_TRAP } from "#tests/helpers/drivers";
import { environmentFrom } from "#tests/helpers/environment";
import { universeCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

const UNIVERSE_ID = "1234567890";
const ICON_PATH = "assets/icon.png";
const ICON_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const NEW_ICON_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);

type FakeHttpClient = ReturnType<typeof createFakeHttpClient>;

const unused = {
	create() {
		throw new Error("Unexpected create");
	},
	retire() {
		throw new Error("Unexpected retire");
	},
};

interface UniverseBodyOptions {
	readonly owner?:
		| { readonly group: string; readonly user: undefined }
		| { readonly user: string };
	readonly startPlaceId?: string;
}

function universeBody({
	owner = { user: "users/7777" },
	startPlaceId = "4711",
}: UniverseBodyOptions = {}): unknown {
	return validUniverseBody({
		...owner,
		path: `universes/${UNIVERSE_ID}`,
		rootPlace: `universes/${UNIVERSE_ID}/places/${startPlaceId}`,
	});
}

function operation(id: string, response?: unknown): unknown {
	return {
		done: response !== undefined,
		operationId: id,
		path: `operations/${id}`,
		...(response === undefined ? {} : { response }),
	};
}

function mockImageUpload(
	assets: FakeHttpClient,
	{ assetId = "789", moderationState = "Approved" } = {},
): FakeHttpClient {
	return assets.mockResponse({ body: operation("op-create"), status: 200 }).mockResponse({
		body: operation("op-create", {
			assetId,
			moderationResult: { moderationState },
			path: `assets/${assetId}`,
		}),
		status: 200,
	});
}

function mockIconUpdate(assets: FakeHttpClient, placeId = "4711"): FakeHttpClient {
	return assets.mockResponse({ body: operation("op-update"), status: 200 }).mockResponse({
		body: operation("op-update", { assetId: placeId, path: `assets/${placeId}` }),
		status: 200,
	});
}

function iconFixture({
	config,
	files = { [ICON_PATH]: ICON_BYTES },
	resources = [],
	withAssets = true,
}: {
	readonly config: Config;
	readonly files?: Readonly<Record<string, Uint8Array>>;
	readonly resources?: ReadonlyArray<ResourceCurrentState>;
	readonly withAssets?: boolean;
}) {
	const http = createFakeHttpClient();
	const assetsHttp = createFakeHttpClient();
	const store = fakeStateStore({
		initial: { production: { environment: "production", resources, version: 1 } },
	});
	const events: Array<ProgressEvent> = [];
	const clientOptions = {
		credential: { apiKey: "fake", kind: "apiKey" } as const,
		sleep: async () => {},
	};
	async function readFile(path: string): Promise<Uint8Array> {
		const bytes = files[path];
		assert(bytes !== undefined, `unexpected read of ${path}`);
		return bytes;
	}

	const registry: DriverRegistry = {
		badge: BADGE_TRAP,
		developerProduct: unused,
		gamePass: unused,
		place: unused,
		universe: createUniverseDriver({
			...(withAssets
				? {
						icon: {
							assets: new AssetsClient({ ...clientOptions, httpClient: assetsHttp }),
							readFile,
						},
					}
				: {}),
			places: new PlacesClient({ ...clientOptions, httpClient: http }),
			universes: new UniversesClient({ ...clientOptions, httpClient: http }),
		}),
	};

	return {
		assetsHttp,
		events,
		http,
		async run() {
			return deploy({
				config,
				environment: "production",
				getEnv: environmentFrom({}),
				progress: {
					emit: (event) => {
						events.push(event);
					},
				},
				readFile,
				registry,
				statePort: store.port,
			});
		},
		store,
	};
}

function universeOf(
	store: ReturnType<typeof fakeStateStore>,
): ResourceCurrentState<"universe"> | undefined {
	const universe = store.states
		.get("production")
		?.resources.find((resource) => resource.kind === "universe");
	return universe?.kind === "universe" ? universe : undefined;
}

function requestLines(httpClient: FakeHttpClient): ReadonlyArray<string> {
	return httpClient.requests.map(({ request }) => `${request.method} ${request.url}`);
}

async function formRequestPart(httpClient: FakeHttpClient, index: number): Promise<JSONValue> {
	const { body } = httpClient.requests[index]!.request;
	assert(body instanceof FormData, "request body should be multipart");
	const part = body.get("request");
	assert(part !== null, "multipart body should have a request part");
	return JSON.parse(typeof part === "string" ? part : await part.text());
}

function sha256Of(bytes: Uint8Array): ReturnType<typeof asSha256Hex> {
	return asSha256Hex(createHash("sha256").update(bytes).digest("hex"));
}

function universeWithIcon({
	iconStartPlaceId = "4711",
	rootPlaceId = "4711",
} = {}): ResourceCurrentState<"universe"> {
	return universeCurrent({
		icon: { "en-us": ICON_PATH },
		iconFileHashes: { "en-us": sha256Of(ICON_BYTES) },
		outputs: {
			iconAssetIds: { "en-us": asRobloxAssetId("789") },
			iconStartPlaceId: asRobloxAssetId(iconStartPlaceId),
			rootPlaceId: asRobloxAssetId(rootPlaceId),
		},
	});
}

const ICON_CONFIG: Config = {
	environments: { production: {} },
	universe: { icon: { "en-us": ICON_PATH }, universeId: UNIVERSE_ID },
};

describe("experience icon", () => {
	it.for([
		{ creator: { userId: "7777" }, owner: { user: "users/7777" } },
		{ creator: { groupId: "42" }, owner: { group: "groups/42", user: undefined } },
	] as const)(
		"should upload the icon as the universe owner %o and set it on the live start place",
		async ({ creator, owner }, { expect }) => {
			expect.hasAssertions();

			const fixture = iconFixture({ config: ICON_CONFIG });
			fixture.http.mockResponse({ body: universeBody({ owner }), status: 200 });
			mockIconUpdate(mockImageUpload(fixture.assetsHttp));

			const result = await fixture.run();

			expect(result.success).toBeTrue();
			expect(requestLines(fixture.assetsHttp)).toStrictEqual([
				"POST /assets/v1/assets",
				"GET /assets/v1/operations/op-create",
				"PATCH /assets/v1/assets/4711?updateMask=icon",
				"GET /assets/v1/operations/op-update",
			]);
			await expect(formRequestPart(fixture.assetsHttp, 0)).resolves.toMatchObject({
				assetType: "Image",
				creationContext: { creator },
				displayName: "Experience icon",
			});
			await expect(formRequestPart(fixture.assetsHttp, 2)).resolves.toStrictEqual({
				assetId: "4711",
				icon: "assets/789",
			});
			expect(universeOf(fixture.store)!.outputs).toStrictEqual({
				iconAssetIds: { "en-us": asRobloxAssetId("789") },
				iconStartPlaceId: asRobloxAssetId("4711"),
				rootPlaceId: asRobloxAssetId("4711"),
			});
		},
	);

	it("should fail the universe when setting the icon on the start place is refused", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = iconFixture({ config: ICON_CONFIG });
		fixture.http.mockResponse({ body: universeBody(), status: 200 });
		mockImageUpload(fixture.assetsHttp).mockApiError({
			code: "PERMISSION_DENIED",
			message: "Icon refused",
			statusCode: 403,
		});

		const result = await fixture.run();

		expect(result.success).toBeFalse();
		expect(fixture.events.find((event) => event.kind === "resourceOpFailed")).toMatchObject({
			error: { cause: { message: "Icon refused" } },
			resourceKind: "universe",
		});
	});

	it("should fail the universe when its driver has no assets client for the icon", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = iconFixture({ config: ICON_CONFIG, withAssets: false });
		fixture.http.mockResponse({ body: universeBody(), status: 200 });

		const result = await fixture.run();

		assert(!result.success, "deploy should fail without an assets client");

		expect(fixture.events.find((event) => event.kind === "resourceOpFailed")).toMatchObject({
			error: {
				cause: {
					message:
						"Universe driver needs an assets client and a file reader to set the experience icon",
				},
			},
			resourceKind: "universe",
		});
	});

	it("should neither upload nor set the icon when the icon file is unchanged", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = iconFixture({ config: ICON_CONFIG, resources: [universeWithIcon()] });
		fixture.http.mockResponse({ body: universeBody(), status: 200 });

		const result = await fixture.run();

		expect(result.success).toBeTrue();
		expect(fixture.assetsHttp.requests).toBeEmpty();
		expect(universeOf(fixture.store)!.outputs.iconAssetIds).toStrictEqual({
			"en-us": asRobloxAssetId("789"),
		});
	});

	it("should upload a changed icon file once and set the new icon", async ({ expect }) => {
		expect.hasAssertions();

		const fixture = iconFixture({
			config: ICON_CONFIG,
			files: { [ICON_PATH]: NEW_ICON_BYTES },
			resources: [universeWithIcon()],
		});
		fixture.http
			.mockResponse({ body: universeBody(), status: 200 })
			.mockResponse({ body: universeBody(), status: 200 });
		mockIconUpdate(mockImageUpload(fixture.assetsHttp, { assetId: "790" }));

		const result = await fixture.run();

		expect(result.success).toBeTrue();
		expect(requestLines(fixture.assetsHttp)).toStrictEqual([
			"POST /assets/v1/assets",
			"GET /assets/v1/operations/op-create",
			"PATCH /assets/v1/assets/4711?updateMask=icon",
			"GET /assets/v1/operations/op-update",
		]);
		await expect(formRequestPart(fixture.assetsHttp, 2)).resolves.toStrictEqual({
			assetId: "4711",
			icon: "assets/790",
		});
		expect(universeOf(fixture.store)).toMatchObject({
			iconFileHashes: { "en-us": sha256Of(NEW_ICON_BYTES) },
			outputs: { iconAssetIds: { "en-us": asRobloxAssetId("790") } },
		});
	});

	it.for([
		{ label: "a tracked icon", resources: [universeWithIcon()], universeReads: 2 },
		{ label: "a first deploy", resources: [], universeReads: 1 },
	])(
		"should remove the icon from the start place for none on $label",
		async ({ resources, universeReads }, { expect }) => {
			expect.hasAssertions();

			const fixture = iconFixture({
				config: {
					environments: { production: {} },
					universe: { icon: none, universeId: UNIVERSE_ID },
				},
				resources,
			});
			for (let read = 0; read < universeReads; read += 1) {
				fixture.http.mockResponse({ body: universeBody(), status: 200 });
			}

			mockIconUpdate(fixture.assetsHttp);

			const result = await fixture.run();

			expect(result.success).toBeTrue();
			expect(requestLines(fixture.assetsHttp)).toStrictEqual([
				"PATCH /assets/v1/assets/4711?updateMask=icon",
				"GET /assets/v1/operations/op-update",
			]);
			await expect(formRequestPart(fixture.assetsHttp, 0)).resolves.toStrictEqual({
				assetId: "4711",
				icon: "",
			});
			expect(universeOf(fixture.store)!.outputs).toStrictEqual({
				rootPlaceId: asRobloxAssetId("4711"),
			});
		},
	);

	it("should send nothing for an omitted icon on a universe with a tracked icon", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = iconFixture({
			config: { environments: { production: {} }, universe: { universeId: UNIVERSE_ID } },
			resources: [universeWithIcon()],
		});
		fixture.http.mockResponse({ body: universeBody(), status: 200 });

		const result = await fixture.run();

		expect(result.success).toBeTrue();
		expect(fixture.assetsHttp.requests).toBeEmpty();
		expect(fixture.events).toContainEqual(
			expect.objectContaining({ kind: "resourceOpNoop", resourceKind: "universe" }),
		);
	});

	it("should fail the universe when removing the icon is refused", async ({ expect }) => {
		expect.hasAssertions();

		const fixture = iconFixture({
			config: {
				environments: { production: {} },
				universe: { icon: none, universeId: UNIVERSE_ID },
			},
		});
		fixture.http.mockResponse({ body: universeBody(), status: 200 });
		fixture.assetsHttp.mockApiError({
			code: "PERMISSION_DENIED",
			message: "Removal refused",
			statusCode: 403,
		});

		const result = await fixture.run();

		expect(result.success).toBeFalse();
		expect(fixture.events.find((event) => event.kind === "resourceOpFailed")).toMatchObject({
			error: { cause: { message: "Removal refused" } },
		});
	});

	it("should fail the universe without setting the icon when the image upload is refused", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = iconFixture({ config: ICON_CONFIG });
		fixture.http.mockResponse({ body: universeBody(), status: 200 });
		fixture.assetsHttp.mockApiError({
			code: "INVALID_ARGUMENT",
			message: "Upload refused",
			statusCode: 400,
		});

		const result = await fixture.run();

		expect(result.success).toBeFalse();
		expect(requestLines(fixture.assetsHttp)).toStrictEqual(["POST /assets/v1/assets"]);
		expect(fixture.events.find((event) => event.kind === "resourceOpFailed")).toMatchObject({
			error: { cause: { message: "Upload refused" } },
		});
	});

	it("should set the existing icon on a changed start place without a new upload", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = iconFixture({ config: ICON_CONFIG, resources: [universeWithIcon()] });
		fixture.http
			.mockResponse({ body: universeBody({ startPlaceId: "4800" }), status: 200 })
			.mockResponse({ body: universeBody({ startPlaceId: "4800" }), status: 200 });
		mockIconUpdate(fixture.assetsHttp, "4800");

		const result = await fixture.run();

		expect(result.success).toBeTrue();
		expect(requestLines(fixture.assetsHttp)).toStrictEqual([
			"PATCH /assets/v1/assets/4800?updateMask=icon",
			"GET /assets/v1/operations/op-update",
		]);
		await expect(formRequestPart(fixture.assetsHttp, 0)).resolves.toStrictEqual({
			assetId: "4800",
			icon: "assets/789",
		});
		expect(fixture.events.find((event) => event.kind === "liveCheck")).toMatchObject({
			check: {
				edits: [
					{
						key: "main",
						fields: [{ current: "4711", field: "iconStartPlaceId", live: "4800" }],
						kind: "universe",
					},
				],
			},
		});
		expect(universeOf(fixture.store)!.outputs).toStrictEqual({
			iconAssetIds: { "en-us": asRobloxAssetId("789") },
			iconStartPlaceId: asRobloxAssetId("4800"),
			rootPlaceId: asRobloxAssetId("4800"),
		});
	});

	it("should send nothing on later deploys once none has removed the icon", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = iconFixture({
			config: {
				environments: { production: {} },
				universe: { icon: none, universeId: UNIVERSE_ID },
			},
			resources: [universeCurrent({ icon: undefined })],
		});
		fixture.http.mockResponse({ body: universeBody(), status: 200 });

		const result = await fixture.run();

		expect(result.success).toBeTrue();
		expect(fixture.assetsHttp.requests).toBeEmpty();
		expect(fixture.events).toContainEqual(
			expect.objectContaining({ kind: "resourceOpNoop", resourceKind: "universe" }),
		);
	});

	it("should keep the recorded icon when only another universe field changes", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = iconFixture({
			config: {
				environments: { production: {} },
				universe: {
					displayName: "Renamed",
					icon: { "en-us": ICON_PATH },
					universeId: UNIVERSE_ID,
				},
			},
			resources: [universeWithIcon()],
		});
		fixture.http
			.mockResponse({ body: universeBody(), status: 200 })
			.mockResponse({ body: universeBody(), status: 200 })
			.mockResponse({ body: validPlaceBody(), status: 200 });

		const result = await fixture.run();

		expect(result.success).toBeTrue();
		expect(fixture.assetsHttp.requests).toBeEmpty();
		expect(universeOf(fixture.store)!.outputs).toStrictEqual({
			iconAssetIds: { "en-us": asRobloxAssetId("789") },
			iconStartPlaceId: asRobloxAssetId("4711"),
			rootPlaceId: asRobloxAssetId("4711"),
		});
	});

	it("should report an uploaded icon that moderation is reviewing once and still succeed", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = iconFixture({ config: ICON_CONFIG });
		fixture.http.mockResponse({ body: universeBody(), status: 200 });
		mockIconUpdate(mockImageUpload(fixture.assetsHttp, { moderationState: "Reviewing" }));

		const result = await fixture.run();

		expect(result.success).toBeTrue();
		expect(
			fixture.events.filter((event) => event.kind === "iconPendingModeration"),
		).toStrictEqual([
			{
				key: "main",
				environment: "production",
				iconAssetId: "789",
				kind: "iconPendingModeration",
				resourceKind: "universe",
			},
		]);
	});

	it("should report no pending moderation for an approved icon", async ({ expect }) => {
		expect.hasAssertions();

		const fixture = iconFixture({ config: ICON_CONFIG });
		fixture.http.mockResponse({ body: universeBody(), status: 200 });
		mockIconUpdate(mockImageUpload(fixture.assetsHttp));

		await fixture.run();

		expect(fixture.events.map((event) => event.kind)).not.toContain("iconPendingModeration");
	});
});
