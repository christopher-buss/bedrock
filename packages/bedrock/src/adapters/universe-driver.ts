import {
	ApiError,
	OpenCloudError,
	requestContextOf,
	type RequestOptions,
	type Result,
	UnexpectedResponseError,
} from "@bedrock-rbx/ocale";
import type { AssetsClient } from "@bedrock-rbx/ocale/assets";
import type { PlacesClient } from "@bedrock-rbx/ocale/places";
import type {
	Universe,
	UniverseOwner,
	UniversesClient,
	UpdateUniverseParameters,
} from "@bedrock-rbx/ocale/universes";

import { changedUniverseFields } from "../core/kinds/universe.ts";
import type { ResourceLiveState } from "../core/live-state.ts";
import {
	type ResourceCurrentState,
	SOCIAL_LINK_FIELDS,
	UNIVERSE_MANAGED_FLAGS,
	type UniverseDesiredState,
	type UniverseOutputs,
} from "../core/resources.ts";
import { UNIVERSE_REMOVAL_UNAVAILABLE } from "../core/retirement-refusals.ts";
import type { ResourceApplyContext, ResourceDriver } from "../ports/resource-driver.ts";
import { asRobloxAssetId, type RobloxAssetId } from "../types/ids.ts";
import {
	readLiveIconOutputsAsync,
	reconcileAssetIconAsync,
	recordedImageInputs,
	setAssetIconAsync,
} from "./asset-icon.ts";
import { applyRequestOptions } from "./create-request-options.ts";

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
	/**
	 * Assets client and file reader that upload and set the experience icon.
	 * A config that declares `universe.icon` fails without them.
	 * @since unreleased
	 */
	readonly icon?: {
		/** Configured assets client from `@bedrock-rbx/ocale/assets`. */
		readonly assets: AssetsClient;
		/** Reads experience-icon bytes for upload. */
		readonly readFile: (path: string) => Promise<Uint8Array>;
	};
	/** Configured places client from `@bedrock-rbx/ocale/places`. */
	readonly places: PlacesClient;
	/** Configured universes client from `@bedrock-rbx/ocale/universes`. */
	readonly universes: UniversesClient;
}

/** Icon fields of the universe outputs. */
type ExperienceIconOutputs = Pick<UniverseOutputs, "iconAssetIds" | "iconStartPlaceId">;

interface ResolvedUniverse {
	readonly owner: UniverseOwner;
	readonly rootPlaceId: string;
}

interface ReconcileInputs {
	readonly context: ResourceApplyContext | undefined;
	readonly current: ResourceCurrentState<"universe"> | undefined;
	readonly deps: UniverseDriverDeps;
	readonly desired: UniverseDesiredState;
}

interface IconReconcileInputs extends ReconcileInputs {
	readonly fields: ReadonlySet<string>;
	readonly options: RequestOptions | undefined;
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
 * absent surfaces as an `UnexpectedResponseError`, mirroring the
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
 * `read` (since unreleased) gets the readable universe settings in Live state
 * shape. A missing universe returns `Ok(undefined)`; other read failures are
 * retained. Unclassified visibility is unreadable and stays absent.
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
 *         credential: { apiKey: "rbx-your-key", kind: "apiKey" },
 *         httpClient: universeBodyHttpClient,
 *         sleep: async () => {},
 *     }),
 *     universes: new UniversesClient({
 *         credential: { apiKey: "rbx-your-key", kind: "apiKey" },
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
 *     .then(async (result) => {
 *         expect(result.success).toBeTrue();
 *         if (result.success) {
 *             expect(result.data.outputs.rootPlaceId).toBe("4711");
 *         }
 *         const live = await driver.read!(asRobloxAssetId("1234567890"));
 *         expect(live.success).toBeTrue();
 *         if (live.success) {
 *             expect(live.data?.desktopEnabled).toBeTrue();
 *             expect(live.data?.kind).toBe("universe");
 *         }
 *     });
 * ```
 */
export function createUniverseDriver(deps: UniverseDriverDeps): ResourceDriver<"universe"> {
	return {
		async create(desired, context) {
			return reconcileUniverseAsync({ context, current: undefined, deps, desired });
		},
		async read(universeId) {
			return readUniverseAsync(deps, universeId);
		},
		// eslint-disable-next-line ts/require-await -- required async driver contract; this kind refuses retirement without I/O.
		async retire() {
			return {
				err: new OpenCloudError(UNIVERSE_REMOVAL_UNAVAILABLE),
				success: false,
			};
		},
		// eslint-disable-next-line better-max-params/better-max-params -- signature is fixed by the ResourceDriver.setVisibility port contract (universeId, visibility, context).
		async setVisibility(universeId, visibility, context) {
			const options = applyRequestOptions(context);
			return visibility === "public"
				? deps.universes.activate({ universeId }, options)
				: deps.universes.deactivate({ universeId }, options);
		},
		// eslint-disable-next-line better-max-params/better-max-params -- signature is fixed by the ResourceDriver.update port contract (current, desired, context).
		async update(current, desired, context) {
			return reconcileUniverseAsync({ context, current, deps, desired });
		},
	};
}

function toCurrentState(
	desired: UniverseDesiredState,
	{ icon, rootPlaceId }: { icon: ExperienceIconOutputs; rootPlaceId: string },
): ResourceCurrentState<"universe"> {
	return {
		...desired,
		outputs: { ...icon, rootPlaceId: asRobloxAssetId(rootPlaceId) },
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
			{ ...requestContextOf(err), cause: err, statusCode: 404 },
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
	{
		desired,
		fields,
		options,
	}: {
		desired: UniverseDesiredState;
		fields: ReadonlySet<string>;
		options: RequestOptions | undefined;
	},
): Promise<Result<ResolvedUniverse, OpenCloudError>> {
	const result = await (hasUniverseLevelUpdate(fields)
		? dependencies.universes.update(buildParameters(desired, fields), options)
		: dependencies.universes.get({ universeId: desired.universeId }, options));

	if (!result.success) {
		return { err: wrapUpdateError(result.err, desired), success: false };
	}

	const { rootPlaceId } = result.data;
	if (rootPlaceId === undefined) {
		return {
			err: new UnexpectedResponseError(
				`Malformed universe response for ${desired.universeId}: rootPlaceId missing`,
				{ statusCode: 200 },
			),
			success: false,
		};
	}

	return { data: { owner: result.data.owner, rootPlaceId }, success: true };
}

function recordedIconOutputs(
	current: ResourceCurrentState<"universe"> | undefined,
): ExperienceIconOutputs {
	if (current === undefined) {
		return {};
	}

	const { rootPlaceId, ...icon } = current.outputs;
	return icon;
}

function experienceIconOutputs(
	iconAssetId: RobloxAssetId | undefined,
	startPlaceId: string,
): ExperienceIconOutputs {
	return iconAssetId === undefined
		? {}
		: {
				iconAssetIds: { "en-us": iconAssetId },
				iconStartPlaceId: asRobloxAssetId(startPlaceId),
			};
}

async function reconcileIconAsync(
	{ context, current, deps, desired, fields, options }: IconReconcileInputs,
	{ owner, rootPlaceId }: ResolvedUniverse,
): Promise<Result<ExperienceIconOutputs, OpenCloudError>> {
	const isImageChanged = fields.has("icon");
	return reconcileAssetIconAsync({
		deps: deps.icon,
		isChanged:
			isImageChanged || context?.forceIconUpload === true || fields.has("iconStartPlaceId"),
		missingDeps:
			"Universe driver needs an assets client and a file reader to set the experience icon",
		recorded: recordedIconOutputs(current),
		set: async (icon) => {
			return setAssetIconAsync(icon, {
				icon: desired.icon,
				label: "Experience icon",
				...recordedImageInputs(current?.outputs.iconAssetIds, {
					hashes: desired.iconFileHashes,
					isImageChanged,
				}),
				onPendingModeration: context?.onIconPendingModeration,
				options,
				owner: () => ({ data: owner, success: true }),
				placeId: rootPlaceId,
			});
		},
		toOutputs: (iconAssetId) => experienceIconOutputs(iconAssetId, rootPlaceId),
	});
}

async function reconcileFieldsAsync(
	{ context, current, deps, desired }: ReconcileInputs,
	fields: ReadonlySet<string>,
): Promise<Result<ResourceCurrentState<"universe">, OpenCloudError>> {
	const options = applyRequestOptions(context);
	const universeResult = await resolveUniverseAsync(deps, { desired, fields, options });
	if (!universeResult.success) {
		return universeResult;
	}

	const { rootPlaceId } = universeResult.data;
	const displayName = fields.has("displayName") ? desired.displayName : undefined;
	if (displayName !== undefined) {
		const result = await deps.places.update(
			{ displayName, placeId: rootPlaceId, universeId: desired.universeId },
			options,
		);
		if (!result.success) {
			return { err: result.err, success: false };
		}
	}

	const icon = await reconcileIconAsync(
		{ context, current, deps, desired, fields, options },
		universeResult.data,
	);
	if (!icon.success) {
		return icon;
	}

	return { data: toCurrentState(desired, { icon: icon.data, rootPlaceId }), success: true };
}

async function reconcileUniverseAsync(
	inputs: ReconcileInputs,
): Promise<Result<ResourceCurrentState<"universe">, OpenCloudError>> {
	const fields = changedUniverseFields(inputs.desired, inputs.current);
	const visibility = fields.has("visibility") ? inputs.desired.visibility : undefined;
	if (visibility === "private") {
		const result = await inputs.deps.universes.deactivate(
			{ universeId: inputs.desired.universeId },
			applyRequestOptions(inputs.context),
		);
		if (!result.success) {
			return result;
		}
	}

	const result = await reconcileFieldsAsync(inputs, fields);
	if (!result.success) {
		return result;
	}

	if (visibility === "public") {
		const activated = await inputs.deps.universes.activate(
			{ universeId: inputs.desired.universeId },
			applyRequestOptions(inputs.context),
		);
		if (!activated.success) {
			return activated;
		}
	}

	return result;
}

function universeLiveState(
	universe: Universe,
	icon: Pick<ResourceLiveState<"universe">["outputs"], "iconAssetIds">,
): ResourceLiveState<"universe"> {
	return {
		...(universe.visibility === "unspecified" ? {} : { visibility: universe.visibility }),
		consoleEnabled: universe.consoleEnabled,
		desktopEnabled: universe.desktopEnabled,
		displayName: universe.displayName,
		kind: "universe",
		mobileEnabled: universe.mobileEnabled,
		outputs:
			universe.rootPlaceId === undefined
				? {}
				: { ...icon, rootPlaceId: asRobloxAssetId(universe.rootPlaceId) },
		privateServerPriceRobux: universe.privateServerPriceRobux,
		tabletEnabled: universe.tabletEnabled,
		voiceChatEnabled: universe.voiceChatEnabled,
		vrEnabled: universe.vrEnabled,
		...Object.fromEntries(SOCIAL_LINK_FIELDS.map((field) => [field, universe[field]])),
	};
}

async function readUniverseAsync(
	deps: UniverseDriverDeps,
	universeId: string,
): Promise<Result<ResourceLiveState<"universe"> | undefined, OpenCloudError>> {
	const result = await deps.universes.get({ universeId });
	if (!result.success) {
		return result.err instanceof ApiError && result.err.statusCode === 404
			? { data: undefined, success: true }
			: result;
	}

	const icon = await readLiveIconOutputsAsync(deps.icon?.assets, result.data.rootPlaceId);
	return { data: universeLiveState(result.data, icon), success: true };
}
