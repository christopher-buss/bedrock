import { ApiError, type OpenCloudError, type Result } from "@bedrock/ocale";
import type { DeveloperProduct, DeveloperProductsClient } from "@bedrock/ocale/developer-products";

import type { DeveloperProductDesiredState, ResourceCurrentState } from "../core/resources.ts";
import type { ResourceDriver } from "../ports/resource-driver.ts";
import { asRobloxAssetId, type RobloxAssetId } from "../types/ids.ts";

/**
 * Dependencies of `createDeveloperProductDriver`. `universeId` is captured
 * at construction time (matching `GamePassDriverDeps`) so each driver
 * instance is bound to a single universe; multi-universe deploys construct
 * one driver per universe.
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
 *     universeId: asRobloxAssetId("1234567890"),
 * };
 *
 * expect(deps.universeId).toBe("1234567890");
 * ```
 */
export interface DeveloperProductDriverDeps {
	/** Configured developer-products client from `@bedrock/ocale/developer-products`. */
	readonly client: DeveloperProductsClient;
	/** Universe that owns every developer product this driver creates. */
	readonly universeId: RobloxAssetId;
}

/**
 * Wraps {@link DeveloperProductsClient} as a `ResourceDriver<"developerProduct">`
 * that maps a desired-state entry to an ocale create call and the response
 * back to a `ResourceCurrentState<"developerProduct">`.
 *
 * Slice 1 of #113 ships create only with `name` and `description`.
 * Subsequent slices add `update`, the icon hash-diff cost-gate, the
 * Mantle-style `price` semantics, and the `storePageEnabled` POST→PATCH
 * dance.
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
 *     universeId: asRobloxAssetId("1234567890"),
 * });
 *
 * return driver
 *     .create({
 *         description: "Stocks the player up with 1,000 premium gems.",
 *         key: asResourceKey("gem-pack"),
 *         kind: "developerProduct",
 *         name: "Gem Pack",
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
			const result = await deps.client.create({
				name: desired.name,
				description: desired.description,
				universeId: deps.universeId,
			});
			if (!result.success) {
				return result;
			}

			return toCurrentState(desired, result.data);
		},
	};
}

function toCurrentState(
	desired: DeveloperProductDesiredState,
	data: DeveloperProduct,
): Result<ResourceCurrentState<"developerProduct">, OpenCloudError> {
	const productIdRaw = data.id;
	if (productIdRaw === "") {
		return {
			err: new ApiError("Malformed developer product response: productId missing", {
				statusCode: 200,
			}),
			success: false,
		};
	}

	const iconImageAssetId =
		data.iconImageAssetId === undefined ? undefined : asRobloxAssetId(data.iconImageAssetId);

	return {
		data: {
			...desired,
			outputs: {
				productId: asRobloxAssetId(productIdRaw),
				...(iconImageAssetId === undefined ? {} : { iconImageAssetId }),
			},
		},
		success: true,
	};
}
