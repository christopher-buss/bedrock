import { ApiError, type OpenCloudError, type Result } from "@bedrock-rbx/ocale";
import type { PlacesClient } from "@bedrock-rbx/ocale/places";
import type { UniversesClient, UpdateUniverseParameters } from "@bedrock-rbx/ocale/universes";

import { changedUniverseFields } from "../core/kinds/universe.ts";
import {
	type ResourceCurrentState,
	SOCIAL_LINK_FIELDS,
	UNIVERSE_MANAGED_FLAGS,
	type UniverseDesiredState,
} from "../core/resources.ts";
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
	/** Configured places client from `@bedrock-rbx/ocale/places`. */
	readonly places: PlacesClient;
	/** Configured universes client from `@bedrock-rbx/ocale/universes`. */
	readonly universes: UniversesClient;
}

interface ResolvedUniverse {
	readonly rootPlaceId: string;
}

interface ReconcileInputs {
	readonly current: ResourceCurrentState<"universe"> | undefined;
	readonly deps: UniverseDriverDeps;
	readonly desired: UniverseDesiredState;
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
 * When `displayName` is declared, the driver routes that field through
 * `PlacesClient.update` on the root place after the universe PATCH
 * succeeds. A subsequent places failure surfaces to the caller as the
 * driver's error result without rolling back the prior universe patch,
 * so callers observing a partial failure should reconcile by
 * reapplying rather than assuming the universe-level fields are
 * unchanged.
 *
 * @param deps - Injected ocale clients (universes plus places for the
 *   read-only universe fields Roblox derives from the root place).
 * @returns A driver indexable by `"universe"` in a `DriverRegistry`.
 *
 * @example
 *
 * ```ts
 * import type { HttpClient } from "@bedrock-rbx/ocale";
 * import { PlacesClient } from "@bedrock-rbx/ocale/places";
 * import { UniversesClient } from "@bedrock-rbx/ocale/universes";
 * import { validUniverseBody } from "@bedrock-rbx/ocale/testing";
 * import {
 *     asRobloxAssetId,
 *     createUniverseDriver,
 *     UNIVERSE_SINGLETON_KEY,
 * } from "@bedrock-rbx/core";
 *
 * const universeBodyHttpClient: HttpClient = {
 *     async request() {
 *         return {
 *             data: {
 *                 body: validUniverseBody({
 *                     path: "universes/1234567890",
 *                     rootPlace: "universes/1234567890/places/4711",
 *                 }),
 *                 headers: {},
 *                 status: 200,
 *             },
 *             success: true,
 *         };
 *     },
 * };
 *
 * const driver = createUniverseDriver({
 *     places: new PlacesClient({
 *         apiKey: "rbx-your-key",
 *         httpClient: universeBodyHttpClient,
 *         sleep: async () => {},
 *     }),
 *     universes: new UniversesClient({
 *         apiKey: "rbx-your-key",
 *         httpClient: universeBodyHttpClient,
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
 *         privateServerPriceRobux: undefined,
 *         tabletEnabled: undefined,
 *         universeId: asRobloxAssetId("1234567890"),
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
			return reconcileUniverse({ current: undefined, deps, desired });
		},
		async update(current, desired) {
			return reconcileUniverse({ current, deps, desired });
		},
	};
}

function toCurrentState(
	desired: UniverseDesiredState,
	rootPlaceId: string,
): ResourceCurrentState<"universe"> {
	return {
		...desired,
		outputs: { rootPlaceId: asRobloxAssetId(rootPlaceId) },
	};
}

function buildParameters(
	desired: UniverseDesiredState,
	fields: ReadonlySet<string>,
): UpdateUniverseParameters {
	const base = UNIVERSE_MANAGED_FLAGS.reduce<UpdateUniverseParameters>(
		(accumulator, flag) =>
			fields.has(flag) ? { ...accumulator, [flag]: desired[flag] } : accumulator,
		{ universeId: desired.universeId },
	);

	const withPrice = fields.has("privateServerPriceRobux")
		? { ...base, privateServerPriceRobux: desired.privateServerPriceRobux }
		: base;

	return SOCIAL_LINK_FIELDS.reduce<UpdateUniverseParameters>((accumulator, field) => {
		return fields.has(field) ? { ...accumulator, [field]: desired[field] } : accumulator;
	}, withPrice);
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

function hasUniverseLevelUpdate(fields: ReadonlySet<string>): boolean {
	return (
		UNIVERSE_MANAGED_FLAGS.some((flag) => fields.has(flag)) ||
		fields.has("privateServerPriceRobux") ||
		SOCIAL_LINK_FIELDS.some((field) => fields.has(field))
	);
}

async function resolveUniverse(
	deps: UniverseDriverDeps,
	target: { desired: UniverseDesiredState; fields: ReadonlySet<string> },
): Promise<Result<ResolvedUniverse, OpenCloudError>> {
	const { desired, fields } = target;
	const result = hasUniverseLevelUpdate(fields)
		? await deps.universes.update(buildParameters(desired, fields))
		: await deps.universes.get({ universeId: desired.universeId });

	if (!result.success) {
		return { err: wrapUpdateError(result.err, desired), success: false };
	}

	const { rootPlaceId } = result.data;
	if (rootPlaceId === undefined) {
		return {
			err: new ApiError(
				`Malformed universe response for ${desired.universeId}: rootPlaceId missing`,
				{ statusCode: 200 },
			),
			success: false,
		};
	}

	return { data: { rootPlaceId }, success: true };
}

async function reconcileUniverse(
	inputs: ReconcileInputs,
): Promise<Result<ResourceCurrentState<"universe">, OpenCloudError>> {
	const { current, deps, desired } = inputs;
	const fields = changedUniverseFields(desired, current);
	const universeResult = await resolveUniverse(deps, { desired, fields });
	if (!universeResult.success) {
		return universeResult;
	}

	const { rootPlaceId } = universeResult.data;
	const displayName = fields.has("displayName") ? desired.displayName : undefined;
	if (displayName !== undefined) {
		const placesResult = await deps.places.update({
			displayName,
			placeId: rootPlaceId,
			universeId: desired.universeId,
		});
		if (!placesResult.success) {
			return { err: placesResult.err, success: false };
		}
	}

	return { data: toCurrentState(desired, rootPlaceId), success: true };
}
