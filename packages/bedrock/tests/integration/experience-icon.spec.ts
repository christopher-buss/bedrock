import { asRobloxAssetId, createUniverseDriver, deploy } from "@bedrock-rbx/core";
import { AssetsClient } from "@bedrock-rbx/ocale/assets";
import { PlacesClient } from "@bedrock-rbx/ocale/places";
import {
	createFakeHttpClient,
	validPlaceBody,
	validUniverseBody,
} from "@bedrock-rbx/ocale/testing";
import { UniversesClient } from "@bedrock-rbx/ocale/universes";

import { assert, describe, it } from "vitest";

import { none } from "#src/core/none";
import type { ResourceCurrentState } from "#src/core/resources";
import type { Config } from "#src/core/schema";
import type { ProgressEvent } from "#src/ports/progress-port";
import type { DriverRegistry } from "#src/ports/resource-driver";
import {
	formRequestPartAsync,
	mockIconUpdate,
	mockImageUpload,
	mockLiveIcon,
	requestLines,
	sha256Of,
	UNUSED_DRIVER,
} from "#tests/helpers/asset-icon";
import { BADGE_TRAP } from "#tests/helpers/drivers";
import { environmentFrom } from "#tests/helpers/environment";
import { universeCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

const UNIVERSE_ID = "1234567890";
const ICON_PATH = "assets/icon.png";
const ICON_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const NEW_ICON_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);

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

const LIVE_ICON_READ = "GET /assets/v1/assets/4711?readMask=icon";

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

	const registry = {
		badge: BADGE_TRAP,
		developerProduct: UNUSED_DRIVER,
		gamePass: UNUSED_DRIVER,
		place: UNUSED_DRIVER,
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
	} satisfies DriverRegistry;

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

const ICON_CONFIG = {
	environments: { production: {} },
	universe: { icon: { "en-us": ICON_PATH }, universeId: UNIVERSE_ID },
} satisfies Config;

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
			mockIconUpdate(mockImageUpload(mockLiveIcon(fixture.assetsHttp, undefined)));

			const result = await fixture.run();

			expect(result.success).toBeTrue();
			expect(requestLines(fixture.assetsHttp)).toStrictEqual([
				LIVE_ICON_READ,
				"POST /assets/v1/assets",
				"GET /assets/v1/operations/op-create",
				"PATCH /assets/v1/assets/4711?updateMask=icon",
				"GET /assets/v1/operations/op-update",
			]);
			await expect(formRequestPartAsync(fixture.assetsHttp, 1)).resolves.toMatchObject({
				assetType: "Image",
				creationContext: { creator },
				displayName: "Experience icon",
			});
			await expect(formRequestPartAsync(fixture.assetsHttp, 3)).resolves.toStrictEqual({
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
		mockImageUpload(mockLiveIcon(fixture.assetsHttp, undefined)).mockApiError({
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
		mockLiveIcon(fixture.assetsHttp, "789");

		const result = await fixture.run();

		expect(result.success).toBeTrue();
		expect(requestLines(fixture.assetsHttp)).toStrictEqual([LIVE_ICON_READ]);
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
		mockIconUpdate(
			mockImageUpload(mockLiveIcon(fixture.assetsHttp, "789"), { assetId: "790" }),
		);

		const result = await fixture.run();

		expect(result.success).toBeTrue();
		expect(requestLines(fixture.assetsHttp)).toStrictEqual([
			LIVE_ICON_READ,
			"POST /assets/v1/assets",
			"GET /assets/v1/operations/op-create",
			"PATCH /assets/v1/assets/4711?updateMask=icon",
			"GET /assets/v1/operations/op-update",
		]);
		await expect(formRequestPartAsync(fixture.assetsHttp, 3)).resolves.toStrictEqual({
			assetId: "4711",
			icon: "assets/790",
		});
		expect(universeOf(fixture.store)).toMatchObject({
			iconFileHashes: { "en-us": sha256Of(NEW_ICON_BYTES) },
			outputs: { iconAssetIds: { "en-us": asRobloxAssetId("790") } },
		});
	});

	it.for([
		{
			iconReads: [LIVE_ICON_READ],
			label: "a tracked icon",
			resources: [universeWithIcon()],
			universeReads: 2,
		},
		{ iconReads: [], label: "a first deploy", resources: [], universeReads: 1 },
	])(
		"should remove the icon from the start place for none on $label",
		async ({ iconReads, resources, universeReads }, { expect }) => {
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

			for (const _read of iconReads) {
				mockLiveIcon(fixture.assetsHttp, "789");
			}

			mockIconUpdate(fixture.assetsHttp);

			const result = await fixture.run();

			expect(result.success).toBeTrue();
			expect(requestLines(fixture.assetsHttp)).toStrictEqual([
				...iconReads,
				"PATCH /assets/v1/assets/4711?updateMask=icon",
				"GET /assets/v1/operations/op-update",
			]);
			await expect(
				formRequestPartAsync(fixture.assetsHttp, iconReads.length),
			).resolves.toStrictEqual({
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
		mockLiveIcon(fixture.assetsHttp, "789");

		const result = await fixture.run();

		expect(result.success).toBeTrue();
		expect(requestLines(fixture.assetsHttp)).toStrictEqual([LIVE_ICON_READ]);
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
		mockLiveIcon(fixture.assetsHttp, undefined).mockApiError({
			code: "INVALID_ARGUMENT",
			message: "Upload refused",
			statusCode: 400,
		});

		const result = await fixture.run();

		expect(result.success).toBeFalse();
		expect(requestLines(fixture.assetsHttp)).toStrictEqual([
			LIVE_ICON_READ,
			"POST /assets/v1/assets",
		]);
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
		fixture.assetsHttp.mockApiError({ code: "PERMISSION_DENIED", statusCode: 403 });
		mockIconUpdate(fixture.assetsHttp, "4800");

		const result = await fixture.run();

		expect(result.success).toBeTrue();
		expect(requestLines(fixture.assetsHttp)).toStrictEqual([
			"GET /assets/v1/assets/4800?readMask=icon",
			"PATCH /assets/v1/assets/4800?updateMask=icon",
			"GET /assets/v1/operations/op-update",
		]);
		await expect(formRequestPartAsync(fixture.assetsHttp, 1)).resolves.toStrictEqual({
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
		mockLiveIcon(fixture.assetsHttp, undefined);

		const result = await fixture.run();

		expect(result.success).toBeTrue();
		expect(requestLines(fixture.assetsHttp)).toStrictEqual([LIVE_ICON_READ]);
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
		mockLiveIcon(fixture.assetsHttp, "789");

		const result = await fixture.run();

		expect(result.success).toBeTrue();
		expect(requestLines(fixture.assetsHttp)).toStrictEqual([LIVE_ICON_READ]);
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
		mockIconUpdate(
			mockImageUpload(mockLiveIcon(fixture.assetsHttp, undefined), {
				moderationState: "Reviewing",
			}),
		);

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
		mockIconUpdate(mockImageUpload(mockLiveIcon(fixture.assetsHttp, undefined)));

		await fixture.run();

		expect(fixture.events.map((event) => event.kind)).not.toContain("iconPendingModeration");
	});

	it.for([
		["assets/icon.png", "image/png"],
		["assets/icon.JPG", "image/jpeg"],
		["assets/icon.jpeg", "image/jpeg"],
		["assets/icon.bmp", "image/bmp"],
		["assets/icon.tga", "image/tga"],
	] as const)("should upload %s as %s", async ([path, contentType], { expect }) => {
		expect.hasAssertions();

		const fixture = iconFixture({
			config: {
				environments: { production: {} },
				universe: { icon: { "en-us": path }, universeId: UNIVERSE_ID },
			},
			files: { [path]: ICON_BYTES },
		});
		fixture.http.mockResponse({ body: universeBody(), status: 200 });
		mockIconUpdate(mockImageUpload(mockLiveIcon(fixture.assetsHttp, undefined)));

		await fixture.run();

		const { body } = fixture.assetsHttp.requests[1]!.request;
		assert(body instanceof FormData, "upload should be multipart");
		const file = body.get("fileContent");
		assert(file instanceof Blob, "upload should carry the file");

		expect(file.type).toBe(contentType);
	});

	it("should fail the universe without an upload for an icon file Roblox cannot take", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const fixture = iconFixture({
			config: {
				environments: { production: {} },
				universe: { icon: { "en-us": "assets/icon.gif" }, universeId: UNIVERSE_ID },
			},
			files: { "assets/icon.gif": ICON_BYTES },
		});
		fixture.http.mockResponse({ body: universeBody(), status: 200 });
		mockLiveIcon(fixture.assetsHttp, undefined);

		const result = await fixture.run();

		expect(result.success).toBeFalse();
		expect(requestLines(fixture.assetsHttp)).toStrictEqual([LIVE_ICON_READ]);
		expect(fixture.events.find((event) => event.kind === "resourceOpFailed")).toMatchObject({
			error: {
				cause: {
					message:
						"Experience icon 'assets/icon.gif' must be a .png, .jpg, .jpeg, .bmp or .tga file",
				},
			},
		});
	});
});
