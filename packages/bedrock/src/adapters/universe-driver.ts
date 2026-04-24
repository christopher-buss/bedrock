import { ApiError, type OpenCloudError, type Result } from "@bedrock/ocale";
import type { PlacesClient } from "@bedrock/ocale/places";
import type { UniversesClient, UpdateUniverseParameters } from "@bedrock/ocale/universes";

import type { ResourceCurrentState, UniverseDesiredState } from "../core/resources.ts";
import { UNIVERSE_MANAGED_FLAGS } from "../core/resources.ts";
import type { ResourceDriver } from "../ports/resource-driver.ts";
import { asRobloxAssetId } from "../types/ids.ts";

/**
 * Dependencies of `createUniverseDriver`. The driver reconciles the
 * universe singleton against both the universes endpoint and the root
 * place (for fields Roblox marks read-only on the universe, like
 * `displayName`). There is no `universeId` at construction time because
 * the universe *is* the resource the driver reconciles, so the ID rides
 * along on each `UniverseDesiredState`.
 */
export interface UniverseDriverDeps {
	/** Configured places client from `@bedrock/ocale/places`. */
	readonly places: PlacesClient;
	/** Configured universes client from `@bedrock/ocale/universes`. */
	readonly universes: UniversesClient;
}

/**
 * Wraps {@link UniversesClient} as a `ResourceDriver<"universe">`. `create`
 * and `update` both delegate to a shared reconcile helper because Open
 * Cloud cannot mint universes; the user supplies an existing `universeId`
 * and bedrock adopts the universe on first apply.
 *
 * A `NotFound` error (HTTP 404) from `UniversesClient.update` is repackaged
 * as an adoption-error `ApiError` whose message names the config key and
 * the `universeId`, so operators can tell adoption failure apart from
 * transient upstream errors. A successful response whose `rootPlaceId` is
 * absent surfaces as an `ApiError` with status 200, mirroring the
 * malformed-response guard in `GamePassDriver`.
 *
 * @param deps - Injected ocale clients (universes plus places for the
 *   read-only universe fields Roblox derives from the root place).
 * @returns A driver indexable by `"universe"` in a `DriverRegistry`.
 *
 * @example
 *
 * ```ts
 * import { PlacesClient } from "@bedrock/ocale/places";
 * import { UniversesClient } from "@bedrock/ocale/universes";
 * import { validUniverseBody } from "@bedrock/ocale/testing";
 * import {
 *     asRobloxAssetId,
 *     createUniverseDriver,
 *     UNIVERSE_SINGLETON_KEY,
 * } from "@bedrock/core";
 *
 * const driver = createUniverseDriver({
 *     places: new PlacesClient({
 *         apiKey: "rbx-your-key",
 *         httpClient: {
 *             async request() {
 *                 return {
 *                     data: {
 *                         body: validUniverseBody({
 *                             path: "universes/1234567890",
 *                             rootPlace: "universes/1234567890/places/4711",
 *                         }),
 *                         headers: {},
 *                         status: 200,
 *                     },
 *                     success: true,
 *                 };
 *             },
 *         },
 *         sleep: async () => {},
 *     }),
 *     universes: new UniversesClient({
 *         apiKey: "rbx-your-key",
 *         httpClient: {
 *             async request() {
 *                 return {
 *                     data: {
 *                         body: validUniverseBody({
 *                             path: "universes/1234567890",
 *                             rootPlace: "universes/1234567890/places/4711",
 *                         }),
 *                         headers: {},
 *                         status: 200,
 *                     },
 *                     success: true,
 *                 };
 *             },
 *         },
 *         sleep: async () => {},
 *     }),
 * });
 *
 * return driver
 *     .create({
 *         consoleEnabled: undefined,
 *         desktopEnabled: true,
 *         displayName: undefined,
 *         key: UNIVERSE_SINGLETON_KEY,
 *         kind: "universe",
 *         mobileEnabled: undefined,
 *         tabletEnabled: undefined,
 *         universeId: asRobloxAssetId("1234567890"),
 *         visibility: undefined,
 *         voiceChatEnabled: true,
 *         vrEnabled: undefined,
 *     })
 *     .then((result) => {
 *         expect(result.success).toBeTrue();
 *         if (result.success) {
 *             expect(result.data.outputs.rootPlaceId).toBe("4711");
 *         }
 *     });
 * ```
 */
export function createUniverseDriver(deps: UniverseDriverDeps): ResourceDriver<"universe"> {
	return {
		async create(desired) {
			return reconcileUniverse(deps, desired);
		},
		async update(_current, desired) {
			return reconcileUniverse(deps, desired);
		},
	};
}

function buildParameters(desired: UniverseDesiredState): UpdateUniverseParameters {
	const base = UNIVERSE_MANAGED_FLAGS.reduce<UpdateUniverseParameters>(
		(accumulator, flag) => {
			const isEnabled = desired[flag];
			return isEnabled === undefined ? accumulator : { ...accumulator, [flag]: isEnabled };
		},
		{ universeId: desired.universeId },
	);

	const withVisibility =
		desired.visibility === undefined ? base : { ...base, visibility: desired.visibility };

	return "privateServerPriceRobux" in desired
		? { ...withVisibility, privateServerPriceRobux: desired.privateServerPriceRobux }
		: withVisibility;
}

function wrapUpdateError(err: OpenCloudError, desired: UniverseDesiredState): OpenCloudError {
	if (err instanceof ApiError && err.statusCode === 404) {
		return new ApiError(
			`Universe ${desired.universeId} (key '${desired.key}') was not found; adoption failed`,
			{ statusCode: 404 },
		);
	}

	return err;
}

function toCurrentState(
	desired: UniverseDesiredState,
	rootPlaceId: string | undefined,
): Result<ResourceCurrentState<"universe">, OpenCloudError> {
	if (rootPlaceId === undefined) {
		return {
			err: new ApiError(
				`Malformed universe response for ${desired.universeId}: rootPlaceId missing`,
				{ statusCode: 200 },
			),
			success: false,
		};
	}

	return {
		data: {
			...desired,
			outputs: { rootPlaceId: asRobloxAssetId(rootPlaceId) },
		},
		success: true,
	};
}

async function reconcileUniverse(
	deps: UniverseDriverDeps,
	desired: UniverseDesiredState,
): Promise<Result<ResourceCurrentState<"universe">, OpenCloudError>> {
	const result = await deps.universes.update(buildParameters(desired));
	if (!result.success) {
		return { err: wrapUpdateError(result.err, desired), success: false };
	}

	return toCurrentState(desired, result.data.rootPlaceId);
}
