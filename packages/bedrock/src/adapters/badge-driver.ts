import { OpenCloudError, type Result, UnexpectedResponseError } from "@bedrock-rbx/ocale";
import type { Badge, BadgesClient, UpdateBadgeParameters } from "@bedrock-rbx/ocale/badges";

import { shouldReuploadIcon } from "../core/icons.ts";
import { withRedactedIcon } from "../core/redacted-icon.ts";
import type { BadgeDesiredState, ResourceCurrentState } from "../core/resources.ts";
import { BADGE_RETIREMENT_UNAVAILABLE } from "../core/retirement-refusals.ts";
import type { ResourceDriver } from "../ports/resource-driver.ts";
import { asRobloxAssetId, type RobloxAssetId } from "../types/ids.ts";

/**
 * Dependencies of `createBadgeDriver`. `universeId` is captured at
 * construction time; `readFile` supplies the icon bytes uploaded on create.
 *
 * @since unreleased
 */
export interface BadgeDriverDeps {
	/** Configured badges client from `@bedrock-rbx/ocale/badges`. */
	readonly client: BadgesClient;
	/**
	 * Reads icon bytes for upload; rejections propagate out of `create` and
	 * `update`.
	 */
	readonly readFile: (path: string) => Promise<Uint8Array>;
	/** Universe that owns every badge this driver creates. */
	readonly universeId: RobloxAssetId;
}

type UpdateBadgeFields = Pick<UpdateBadgeParameters, "description" | "enabled" | "name">;

/**
 * Wraps {@link BadgesClient} as a `ResourceDriver<"badge">`. A create always
 * sends an expected cost of `0` Robux and no payment source, so Roblox
 * refuses a create the free badge quota does not cover instead of charging
 * for it. An update patches only the changed name, description, and enabled
 * fields, and re-uploads the icon only when its file hash changed, recording
 * the uploaded asset ID as `iconImageId`. Retirement is refused without an
 * upstream request.
 *
 * Upstream `OpenCloudError` results pass through as `Result` failures.
 * Filesystem errors from `deps.readFile` propagate as promise rejections.
 *
 * @since unreleased
 *
 * @param deps - Injected ocale client, file reader, and owning universe.
 * @returns A driver indexable by `"badge"` in a `DriverRegistry`.
 * @throws Whatever `deps.readFile` rejects with.
 *
 * @example
 *
 * ```ts
 * import { BadgesClient } from "@bedrock-rbx/ocale/badges";
 * import { createFakeHttpClient, validBadgeBody } from "@bedrock-rbx/ocale/testing";
 * import {
 *     asResourceKey,
 *     asRobloxAssetId,
 *     asSha256Hex,
 *     createBadgeDriver,
 * } from "@bedrock-rbx/core";
 *
 * const httpClient = createFakeHttpClient().mockResponse({
 *     body: validBadgeBody({ id: 2_468_013_579, iconImageId: 1_357_924_680 }),
 *     status: 200,
 * });
 *
 * const driver = createBadgeDriver({
 *     client: new BadgesClient({
 *         credential: { apiKey: "rbx-your-key", kind: "apiKey" },
 *         httpClient,
 *         sleep: async () => {},
 *     }),
 *     readFile: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
 *     universeId: asRobloxAssetId("1234567890"),
 * });
 *
 * return driver.create({
 *     description: "Win your first round.",
 *     enabled: true,
 *     icon: { "en-us": "assets/first-win.png" },
 *     iconFileHashes: {
 *         "en-us": asSha256Hex(
 *             "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 *         ),
 *     },
 *     key: asResourceKey("first-win"),
 *     kind: "badge",
 *     name: "First Win",
 * }).then((result) => {
 *     expect(result).toMatchObject({
 *         data: { outputs: { badgeId: "2468013579", iconImageId: "1357924680" } },
 *         success: true,
 *     });
 * });
 * ```
 */
export function createBadgeDriver(deps: BadgeDriverDeps): ResourceDriver<"badge"> {
	return {
		async create(desired) {
			return createBadgeAsync(deps, desired);
		},
		// eslint-disable-next-line ts/require-await -- required async driver contract; this kind refuses retirement without I/O.
		async retire() {
			return { err: new OpenCloudError(BADGE_RETIREMENT_UNAVAILABLE), success: false };
		},
		async update(current, desired) {
			return updateBadgeAsync(deps, { current, desired });
		},
	};
}

function toCurrentState(
	desired: BadgeDesiredState,
	{ id, iconImageId }: Badge,
): Result<ResourceCurrentState<"badge">, OpenCloudError> {
	if (iconImageId === undefined) {
		return {
			err: new UnexpectedResponseError(
				"Malformed badge response: iconImageId missing after icon upload",
				{ statusCode: 200 },
			),
			success: false,
		};
	}

	return {
		data: {
			...desired,
			outputs: { badgeId: asRobloxAssetId(id), iconImageId: asRobloxAssetId(iconImageId) },
		},
		success: true,
	};
}

async function createBadgeAsync(
	deps: BadgeDriverDeps,
	desired: BadgeDesiredState,
): Promise<Result<ResourceCurrentState<"badge">, OpenCloudError>> {
	const icon = await withRedactedIcon(deps.readFile)(desired.icon["en-us"]);
	const result = await deps.client.create({
		name: desired.name,
		description: desired.description,
		expectedCost: 0,
		icon,
		isActive: desired.enabled,
		universeId: deps.universeId,
	});
	if (!result.success) {
		return result;
	}

	return toCurrentState(desired, result.data);
}

function changedBadgeFields(
	current: ResourceCurrentState<"badge">,
	desired: BadgeDesiredState,
): UpdateBadgeFields {
	return {
		...(desired.name === current.name ? {} : { name: desired.name }),
		...(desired.description === current.description
			? {}
			: { description: desired.description }),
		...(desired.enabled === current.enabled ? {} : { enabled: desired.enabled }),
	};
}

async function uploadChangedIconAsync(
	deps: BadgeDriverDeps,
	{
		current,
		desired,
	}: {
		readonly current: ResourceCurrentState<"badge">;
		readonly desired: BadgeDesiredState;
	},
): Promise<Result<RobloxAssetId, OpenCloudError>> {
	if (!shouldReuploadIcon(current.iconFileHashes, desired.iconFileHashes)) {
		return { data: current.outputs.iconImageId, success: true };
	}

	const icon = await deps.readFile(desired.icon["en-us"]);
	const uploaded = await deps.client.uploadIcon({ badgeId: current.outputs.badgeId, icon });
	if (!uploaded.success) {
		return uploaded;
	}

	return { data: asRobloxAssetId(uploaded.data.iconImageId), success: true };
}

async function updateBadgeAsync(
	deps: BadgeDriverDeps,
	{
		current,
		desired,
	}: {
		readonly current: ResourceCurrentState<"badge">;
		readonly desired: BadgeDesiredState;
	},
): Promise<Result<ResourceCurrentState<"badge">, OpenCloudError>> {
	const fields = changedBadgeFields(current, desired);
	if (Object.keys(fields).length > 0) {
		const updated = await deps.client.update({ badgeId: current.outputs.badgeId, ...fields });
		if (!updated.success) {
			return updated;
		}
	}

	const iconImageId = await uploadChangedIconAsync(deps, { current, desired });
	if (!iconImageId.success) {
		return iconImageId;
	}

	return {
		data: { ...desired, outputs: { ...current.outputs, iconImageId: iconImageId.data } },
		success: true,
	};
}
