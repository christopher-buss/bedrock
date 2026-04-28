import { ApiError, type OpenCloudError, type Result } from "@bedrock/ocale";
import type { ExperienceIconClient } from "@bedrock/ocale/experience-icon";
import type { PlacesClient } from "@bedrock/ocale/places";
import type { UniversesClient, UpdateUniverseParameters } from "@bedrock/ocale/universes";

import { shouldReuploadIcon } from "../core/icons.ts";
import {
	copyDeclaredSocialLinks,
	type ResourceCurrentState,
	SOCIAL_LINK_FIELDS,
	UNIVERSE_MANAGED_FLAGS,
	type UniverseDesiredState,
} from "../core/resources.ts";
import type { ResourceDriver } from "../ports/resource-driver.ts";
import { asRobloxAssetId, type RobloxAssetId } from "../types/ids.ts";

/**
 * Dependencies of `createUniverseDriver`. The driver reconciles the
 * universe singleton against both the universes endpoint and the root
 * place (for fields Roblox marks read-only on the universe, like
 * `displayName`). There is no `universeId` at construction time because
 * the universe *is* the resource the driver reconciles, so the ID rides
 * along on each `UniverseDesiredState`.
 */
export interface UniverseDriverDeps {
	/** Configured experience-icon client from `@bedrock/ocale/experience-icon`. */
	readonly experienceIcons: ExperienceIconClient;
	/** Configured places client from `@bedrock/ocale/places`. */
	readonly places: PlacesClient;
	/** Reads icon bytes for upload; rejections propagate out of `create`/`update`. */
	readonly readFile: (path: string) => Promise<Uint8Array>;
	/** Configured universes client from `@bedrock/ocale/universes`. */
	readonly universes: UniversesClient;
}

interface ResolvedUniverse {
	readonly rootPlaceId: string;
}

interface ToCurrentStateInputs {
	readonly desired: UniverseDesiredState;
	readonly iconAssetIds: Record<"en-us", RobloxAssetId> | undefined;
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
 * import type { HttpClient } from "@bedrock/ocale";
 * import { ExperienceIconClient } from "@bedrock/ocale/experience-icon";
 * import { PlacesClient } from "@bedrock/ocale/places";
 * import { UniversesClient } from "@bedrock/ocale/universes";
 * import { validUniverseBody } from "@bedrock/ocale/testing";
 * import {
 *     asRobloxAssetId,
 *     createUniverseDriver,
 *     UNIVERSE_SINGLETON_KEY,
 * } from "@bedrock/core";
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
 *     experienceIcons: new ExperienceIconClient({
 *         apiKey: "rbx-your-key",
 *         httpClient: universeBodyHttpClient,
 *         sleep: async () => {},
 *     }),
 *     places: new PlacesClient({
 *         apiKey: "rbx-your-key",
 *         httpClient: universeBodyHttpClient,
 *         sleep: async () => {},
 *     }),
 *     readFile: async () => new Uint8Array(),
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
 *         visibility: "public",
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

function toCurrentState(inputs: ToCurrentStateInputs): ResourceCurrentState<"universe"> {
	const { desired, iconAssetIds, rootPlaceId } = inputs;
	const baseOutputs = { rootPlaceId: asRobloxAssetId(rootPlaceId) };
	return {
		...desired,
		outputs: iconAssetIds === undefined ? baseOutputs : { ...baseOutputs, iconAssetIds },
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

	const withPrice =
		"privateServerPriceRobux" in desired
			? { ...withVisibility, privateServerPriceRobux: desired.privateServerPriceRobux }
			: withVisibility;

	return { ...withPrice, ...copyDeclaredSocialLinks(desired) };
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

function hasUniverseLevelUpdate(desired: UniverseDesiredState): boolean {
	if (UNIVERSE_MANAGED_FLAGS.some((flag) => desired[flag] !== undefined)) {
		return true;
	}

	if (desired.visibility !== undefined) {
		return true;
	}

	if ("privateServerPriceRobux" in desired) {
		return true;
	}

	return SOCIAL_LINK_FIELDS.some((field) => field in desired);
}

async function resolveUniverse(
	deps: UniverseDriverDeps,
	desired: UniverseDesiredState,
): Promise<Result<ResolvedUniverse, OpenCloudError>> {
	const result = hasUniverseLevelUpdate(desired)
		? await deps.universes.update(buildParameters(desired))
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

async function captureUploadedIconAssetId(
	deps: UniverseDriverDeps,
	desired: UniverseDesiredState,
): Promise<Result<Record<"en-us", RobloxAssetId>, OpenCloudError>> {
	const listed = await deps.experienceIcons.list({ universeId: desired.universeId });
	if (!listed.success) {
		return listed;
	}

	const enUs = listed.data.find((entry) => entry.languageCode === "en-us");
	if (enUs === undefined) {
		return {
			err: new ApiError(
				`Malformed experience-icon list for ${desired.universeId}: en-us entry missing after upload`,
				{ statusCode: 200 },
			),
			success: false,
		};
	}

	return { data: { "en-us": asRobloxAssetId(enUs.imageId) }, success: true };
}

async function deleteRemovedIcon(
	deps: UniverseDriverDeps,
	desired: UniverseDesiredState,
): Promise<Result<undefined, OpenCloudError>> {
	return deps.experienceIcons.delete({
		languageCode: "en-us",
		universeId: desired.universeId,
	});
}

async function reconcileIcon(
	inputs: ReconcileInputs,
): Promise<Result<Record<"en-us", RobloxAssetId> | undefined, OpenCloudError>> {
	const { current, deps, desired } = inputs;
	if (desired.icon === undefined) {
		return current?.icon === undefined
			? { data: undefined, success: true }
			: deleteRemovedIcon(deps, desired);
	}

	if (!shouldReuploadIcon(current?.iconFileHashes, desired.iconFileHashes)) {
		return { data: current?.outputs.iconAssetIds, success: true };
	}

	const bytes = await deps.readFile(desired.icon["en-us"]);
	const uploaded = await deps.experienceIcons.upload({
		image: bytes,
		languageCode: "en-us",
		universeId: desired.universeId,
	});
	if (!uploaded.success) {
		return uploaded;
	}

	return captureUploadedIconAssetId(deps, desired);
}

async function reconcileUniverse(
	inputs: ReconcileInputs,
): Promise<Result<ResourceCurrentState<"universe">, OpenCloudError>> {
	const { current, deps, desired } = inputs;
	const universeResult = await resolveUniverse(deps, desired);
	if (!universeResult.success) {
		return universeResult;
	}

	const { rootPlaceId } = universeResult.data;
	if (desired.displayName !== undefined) {
		const placesResult = await deps.places.update({
			displayName: desired.displayName,
			placeId: rootPlaceId,
			universeId: desired.universeId,
		});
		if (!placesResult.success) {
			return { err: placesResult.err, success: false };
		}
	}

	const iconResult = await reconcileIcon({ current, deps, desired });
	if (!iconResult.success) {
		return iconResult;
	}

	return {
		data: toCurrentState({ desired, iconAssetIds: iconResult.data, rootPlaceId }),
		success: true,
	};
}
