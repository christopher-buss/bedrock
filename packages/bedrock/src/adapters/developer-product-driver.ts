import type { OpenCloudError, Result } from "@bedrock/ocale";
import type { DeveloperProduct, DeveloperProductsClient } from "@bedrock/ocale/developer-products";

import { derivePriceFields } from "../core/derive-price-fields.ts";
import { shouldReuploadIcon } from "../core/icons.ts";
import { planFollowUpPatch } from "../core/plan-follow-up-patch.ts";
import type { DeveloperProductDesiredState, ResourceCurrentState } from "../core/resources.ts";
import type { ResourceDriver } from "../ports/resource-driver.ts";
import { asRobloxAssetId, type RobloxAssetId } from "../types/ids.ts";

/**
 * Dependencies of `createDeveloperProductDriver`. `universeId` is captured
 * at construction time (matching `GamePassDriverDeps`) so each driver
 * instance is bound to a single universe; multi-universe deploys construct
 * one driver per universe. `readFile` exists on the driver (not upstream
 * in shell) because icon hashes flow through `diff` but bytes do not.
 *
 * @example
 *
 * ```ts
 * import type { HttpClient } from "@bedrock/ocale";
 * import { DeveloperProductsClient } from "@bedrock/ocale/developer-products";
 * import { asRobloxAssetId, type DeveloperProductDriverDeps } from "@bedrock/core";
 *
 * const httpClient: HttpClient = {
 *     async request() {
 *         return { data: { body: {}, headers: {}, status: 200 }, success: true };
 *     },
 * };
 *
 * const deps: DeveloperProductDriverDeps = {
 *     client: new DeveloperProductsClient({
 *         apiKey: "rbx-your-key",
 *         httpClient,
 *         sleep: async () => {},
 *     }),
 *     readFile: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
 *     universeId: asRobloxAssetId("1234567890"),
 * };
 *
 * expect(deps.universeId).toBe("1234567890");
 * ```
 */
export interface DeveloperProductDriverDeps {
	/** Configured developer-products client from `@bedrock/ocale/developer-products`. */
	readonly client: DeveloperProductsClient;
	/** Reads icon bytes for upload; rejections propagate out of `create` and `update`. */
	readonly readFile: (path: string) => Promise<Uint8Array>;
	/** Universe that owns every developer product this driver creates. */
	readonly universeId: RobloxAssetId;
}

interface UpdateInputs {
	readonly current: ResourceCurrentState<"developerProduct">;
	readonly desired: DeveloperProductDesiredState;
}

interface FollowUpPatchInputs {
	readonly created: DeveloperProduct;
	readonly desired: DeveloperProductDesiredState;
}

/**
 * Wraps {@link DeveloperProductsClient} as a `ResourceDriver<"developerProduct">`
 * that maps a desired-state entry to an ocale create or update call and the
 * response back to a `ResourceCurrentState<"developerProduct">`. The
 * `update` path consumes the upstream `204 No Content` response and
 * synthesizes the post-update `ResourceCurrentState` from `desired` plus
 * the existing `current.outputs`, carrying `iconImageAssetId` forward when
 * present.
 *
 * Upstream `OpenCloudError` results pass through as `Result` failures.
 *
 * @param deps - Injected ocale client and owning universe.
 * @returns A driver indexable by `"developerProduct"` in a `DriverRegistry`.
 *
 * @example
 *
 * ```ts
 * import type { HttpClient } from "@bedrock/ocale";
 * import { DeveloperProductsClient } from "@bedrock/ocale/developer-products";
 * import {
 *     asResourceKey,
 *     asRobloxAssetId,
 *     createDeveloperProductDriver,
 * } from "@bedrock/core";
 *
 * const httpClient: HttpClient = {
 *     async request() {
 *         return {
 *             data: {
 *                 body: {
 *                     createdTimestamp: "2024-01-15T10:30:00.000Z",
 *                     description: "Stocks the player up with 1,000 premium gems.",
 *                     iconImageAssetId: null,
 *                     isForSale: false,
 *                     isImmutable: false,
 *                     name: "Gem Pack",
 *                     priceInformation: null,
 *                     productId: 9_876_543_210,
 *                     storePageEnabled: false,
 *                     universeId: 1_234_567_890,
 *                     updatedTimestamp: "2024-01-15T10:30:00.000Z",
 *                 },
 *                 headers: {},
 *                 status: 200,
 *             },
 *             success: true,
 *         };
 *     },
 * };
 *
 * const driver = createDeveloperProductDriver({
 *     client: new DeveloperProductsClient({
 *         apiKey: "rbx-your-key",
 *         httpClient,
 *         sleep: async () => {},
 *     }),
 *     readFile: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
 *     universeId: asRobloxAssetId("1234567890"),
 * });
 *
 * return driver
 *     .create({
 *         description: "Stocks the player up with 1,000 premium gems.",
 *         isRegionalPricingEnabled: undefined,
 *         key: asResourceKey("gem-pack"),
 *         kind: "developerProduct",
 *         name: "Gem Pack",
 *         price: undefined,
 *         storePageEnabled: undefined,
 *     })
 *     .then((result) => {
 *         expect(result.success).toBeTrue();
 *         if (result.success) {
 *             expect(result.data.outputs.productId).toBe("9876543210");
 *         }
 *     });
 * ```
 */
export function createDeveloperProductDriver(
	deps: DeveloperProductDriverDeps,
): ResourceDriver<"developerProduct"> {
	return {
		async create(desired) {
			return createOne(deps, desired);
		},
		async update(current, desired) {
			return updateOne(deps, { current, desired });
		},
	};
}

function toCurrentState(
	desired: DeveloperProductDesiredState,
	data: DeveloperProduct,
): Result<ResourceCurrentState<"developerProduct">, OpenCloudError> {
	const iconImageAssetId =
		data.iconImageAssetId === undefined ? undefined : asRobloxAssetId(data.iconImageAssetId);

	return {
		data: {
			...desired,
			outputs: {
				productId: asRobloxAssetId(data.id),
				...(iconImageAssetId === undefined ? {} : { iconImageAssetId }),
			},
		},
		success: true,
	};
}

async function applyFollowUpPatch(
	deps: DeveloperProductDriverDeps,
	{ created, desired }: FollowUpPatchInputs,
): Promise<Result<ResourceCurrentState<"developerProduct">, OpenCloudError>> {
	const followUp = planFollowUpPatch(desired, created);
	if (followUp === undefined) {
		return toCurrentState(desired, created);
	}

	const patched = await deps.client.update({
		productId: asRobloxAssetId(created.id),
		universeId: deps.universeId,
		...followUp,
	});
	if (!patched.success) {
		return patched;
	}

	return toCurrentState(desired, created);
}

async function createOne(
	deps: DeveloperProductDriverDeps,
	desired: DeveloperProductDesiredState,
): Promise<Result<ResourceCurrentState<"developerProduct">, OpenCloudError>> {
	const imageFile =
		desired.icon === undefined ? undefined : await deps.readFile(desired.icon["en-us"]);
	const created = await deps.client.create({
		name: desired.name,
		description: desired.description,
		universeId: deps.universeId,
		...(imageFile === undefined ? {} : { imageFile }),
		...derivePriceFields(desired),
		...(desired.isRegionalPricingEnabled === undefined
			? {}
			: { isRegionalPricingEnabled: desired.isRegionalPricingEnabled }),
	});
	if (!created.success) {
		return created;
	}

	return applyFollowUpPatch(deps, { created: created.data, desired });
}

async function updateOne(
	deps: DeveloperProductDriverDeps,
	{ current, desired }: UpdateInputs,
): Promise<Result<ResourceCurrentState<"developerProduct">, OpenCloudError>> {
	const imageFile =
		desired.icon !== undefined &&
		shouldReuploadIcon(current.iconFileHashes, desired.iconFileHashes)
			? await deps.readFile(desired.icon["en-us"])
			: undefined;
	const result = await deps.client.update({
		name: desired.name,
		description: desired.description,
		productId: current.outputs.productId,
		universeId: deps.universeId,
		...(imageFile === undefined ? {} : { imageFile }),
		...derivePriceFields(desired),
	});
	if (!result.success) {
		return result;
	}

	// The PATCH endpoint returns 204; the post-update state is the desired
	// entry composed with the existing Roblox-assigned outputs.
	return { data: { ...desired, outputs: current.outputs }, success: true };
}
