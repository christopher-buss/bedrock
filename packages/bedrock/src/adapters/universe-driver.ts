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
 *
 * @since 0.1.0
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
 * @since 0.1.0
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
			return reconcileUniverseAsync({ current: undefined, deps, desired });
		},
		async update(current, desired) {
			return reconcileUniverseAsync({ current, deps, desired });
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
	// Assigned into a fresh local rather than folded with a spread: the rule
	// against spreading a reduce accumulator applies, and mutating a value that
	// never escapes this function keeps the declared parameter type exact.
	const parameters: UpdateUniverseParameters = { universeId: desired.universeId };
	for (const flag of UNIVERSE_MANAGED_FLAGS) {
		if (fields.has(flag)) {
			Object.assign(parameters, { [flag]: desired[flag] });
		}
	}

	if (fields.has("privateServerPriceRobux")) {
		Object.assign(parameters, { privateServerPriceRobux: desired.privateServerPriceRobux });
	}

	for (const field of SOCIAL_LINK_FIELDS) {
		if (fields.has(field)) {
			Object.assign(parameters, { [field]: desired[field] });
		}
	}

	return parameters;
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

async function resolveUniverseAsync(
	dependencies: UniverseDriverDeps,
	{ desired, fields }: { desired: UniverseDesiredState; fields: ReadonlySet<string> },
): Promise<Result<ResolvedUniverse, OpenCloudError>> {
	const result = hasUniverseLevelUpdate(fields)
		? await dependencies.universes.update(buildParameters(desired, fields))
		: await dependencies.universes.get({ universeId: desired.universeId });

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

async function reconcileUniverseAsync({
	current,
	deps,
	desired,
}: ReconcileInputs): Promise<Result<ResourceCurrentState<"universe">, OpenCloudError>> {
	const fields = changedUniverseFields(desired, current);
	const universeResult = await resolveUniverseAsync(deps, { desired, fields });
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
