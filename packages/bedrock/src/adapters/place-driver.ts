import { ApiError, type OpenCloudError, type Result } from "@bedrock-rbx/ocale";
import type { PlacesClient, UpdatePlaceParameters } from "@bedrock-rbx/ocale/places";

import type { PlaceDesiredState, PlaceOutputs, ResourceCurrentState } from "../core/resources.ts";
import { PLACE_MANAGED_METADATA_FIELDS } from "../core/resources.ts";
import type { ResourceDriver } from "../ports/resource-driver.ts";
import type { RobloxAssetId } from "../types/ids.ts";

/**
 * Dependencies of `createPlaceDriver`. `universeId` is captured at
 * construction time (matching `GamePassDriverDeps`) so each driver instance
 * is bound to a single universe; multi-universe deploys construct one driver
 * per universe. `readFile` is injected because `diff` operates on file hashes
 * while the driver is the only place that needs the raw bytes.
 *
 * @example
 *
 * ```ts
 * import type { HttpClient } from "@bedrock-rbx/ocale";
 * import { PlacesClient } from "@bedrock-rbx/ocale/places";
 * import { asRobloxAssetId, type PlaceDriverDeps } from "@bedrock-rbx/core";
 *
 * const httpClient: HttpClient = {
 *     async request() {
 *         return { data: { body: {}, headers: {}, status: 200 }, success: true };
 *     },
 * };
 *
 * const deps: PlaceDriverDeps = {
 *     client: new PlacesClient({
 *         apiKey: "rbx-your-key",
 *         httpClient,
 *         sleep: async () => {},
 *     }),
 *     readFile: async () => new Uint8Array(),
 *     universeId: asRobloxAssetId("1234567890"),
 * };
 *
 * expect(deps.universeId).toBe("1234567890");
 * ```
 */
export interface PlaceDriverDeps {
	/** Configured places client from `@bedrock-rbx/ocale/places`. */
	readonly client: PlacesClient;
	/** Reads place-file bytes for upload; rejections propagate out of the driver. */
	readonly readFile: (path: string) => Promise<Uint8Array>;
	/** Universe that owns every place this driver publishes. */
	readonly universeId: RobloxAssetId;
}

/**
 * Wraps {@link PlacesClient} as a `ResourceDriver<"place">`. `create` and
 * `update` are both thin wrappers over a shared publish helper because the
 * upstream Open Cloud call is identical either way: there is no "create
 * place" endpoint (the place is user-supplied input), only "publish version".
 *
 * Format is detected from the file extension (`.rbxl` → binary,
 * `.rbxlx` → XML); any other extension returns an `ApiError`-backed failure
 * without hitting the network.
 *
 * @param deps - Injected ocale client, file reader, and owning universe.
 * @returns A driver indexable by `"place"` in a `DriverRegistry`.
 * @throws Whatever `deps.readFile` rejects with.
 *
 * @example
 *
 * ```ts
 * import type { HttpClient } from "@bedrock-rbx/ocale";
 * import { PlacesClient } from "@bedrock-rbx/ocale/places";
 * import {
 *     asResourceKey,
 *     asRobloxAssetId,
 *     asSha256Hex,
 *     createPlaceDriver,
 * } from "@bedrock-rbx/core";
 *
 * const httpClient: HttpClient = {
 *     async request() {
 *         return {
 *             data: { body: { versionNumber: 1 }, headers: {}, status: 200 },
 *             success: true,
 *         };
 *     },
 * };
 *
 * const driver = createPlaceDriver({
 *     client: new PlacesClient({
 *         apiKey: "rbx-your-key",
 *         httpClient,
 *         sleep: async () => {},
 *     }),
 *     readFile: async () =>
 *         new Uint8Array([
 *             0x3c, 0x72, 0x6f, 0x62, 0x6c, 0x6f, 0x78, 0x21, 0x89, 0xff, 0x0d, 0x0a, 0x1a,
 *             0x0a,
 *         ]),
 *     universeId: asRobloxAssetId("1234567890"),
 * });
 *
 * return driver
 *     .create({
 *         description: undefined,
 *         displayName: undefined,
 *         fileHash: asSha256Hex(
 *             "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 *         ),
 *         filePath: "places/start.rbxl",
 *         key: asResourceKey("start-place"),
 *         kind: "place",
 *         placeId: asRobloxAssetId("4711"),
 *         serverSize: undefined,
 *     })
 *     .then((result) => {
 *         expect(result.success).toBeTrue();
 *         if (result.success) {
 *             expect(result.data.outputs.versionNumber).toBe(1);
 *         }
 *     });
 * ```
 */
export function createPlaceDriver(deps: PlaceDriverDeps): ResourceDriver<"place"> {
	return {
		async create(desired) {
			return publishPlace(deps, desired);
		},
		async update(_current, desired) {
			return publishPlace(deps, desired);
		},
	};
}

function buildMetadataParameters(
	universeId: RobloxAssetId,
	desired: PlaceDesiredState,
): undefined | UpdatePlaceParameters {
	const metadata = PLACE_MANAGED_METADATA_FIELDS.reduce<Partial<UpdatePlaceParameters>>(
		(accumulator, field) => {
			const value = desired[field];
			return value === undefined ? accumulator : { ...accumulator, [field]: value };
		},
		{},
	);

	if (Object.keys(metadata).length === 0) {
		return undefined;
	}

	return { ...metadata, placeId: desired.placeId, universeId };
}

function detectFormat(filePath: string): "rbxl" | "rbxlx" | undefined {
	if (filePath.endsWith(".rbxlx")) {
		return "rbxlx";
	}

	if (filePath.endsWith(".rbxl")) {
		return "rbxl";
	}

	return undefined;
}

async function publishVersion(
	deps: PlaceDriverDeps,
	desired: PlaceDesiredState,
): Promise<Result<PlaceOutputs, OpenCloudError>> {
	const format = detectFormat(desired.filePath);
	if (format === undefined) {
		return {
			err: new ApiError(
				`Unsupported place file extension for ${desired.filePath}; expected .rbxl or .rbxlx`,
				{ statusCode: 0 },
			),
			success: false,
		};
	}

	const body = await deps.readFile(desired.filePath);
	return deps.client.publish({
		// Narrows `Uint8Array<ArrayBufferLike>` to `Uint8Array<ArrayBuffer>`
		// so the ocale wire type rejects SharedArrayBuffer at the call site.
		body: Uint8Array.from(body),
		format,
		placeId: desired.placeId,
		universeId: deps.universeId,
	});
}

async function publishPlace(
	deps: PlaceDriverDeps,
	desired: PlaceDesiredState,
): Promise<Result<ResourceCurrentState<"place">, OpenCloudError>> {
	const publishResult = await publishVersion(deps, desired);
	if (!publishResult.success) {
		return publishResult;
	}

	const metadataParameters = buildMetadataParameters(deps.universeId, desired);
	if (metadataParameters !== undefined) {
		const metadataResult = await deps.client.update(metadataParameters);
		if (!metadataResult.success) {
			return metadataResult;
		}
	}

	return { data: { ...desired, outputs: publishResult.data }, success: true };
}
