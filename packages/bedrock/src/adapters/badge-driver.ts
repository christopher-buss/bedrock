import {
	ApiError,
	type OpenCloudError,
	type Result,
	UnexpectedResponseError,
} from "@bedrock-rbx/ocale";
import type {
	Badge,
	BadgeDetails,
	BadgePaymentSource,
	BadgesClient,
} from "@bedrock-rbx/ocale/badges";
import type { UniversesClient } from "@bedrock-rbx/ocale/universes";

import { shouldReuploadIcon } from "../core/icons.ts";
import type { ResourceLiveState } from "../core/live-state.ts";
import { REDACTED_ICON_PATH, withRedactedIcon } from "../core/redacted-icon.ts";
import type { BadgeDesiredState, ResourceCurrentState } from "../core/resources.ts";
import { retiredResourceName } from "../core/retired-resource-name.ts";
import type { ResourceDriver } from "../ports/resource-driver.ts";
import { asRobloxAssetId, type RobloxAssetId } from "../types/ids.ts";
import { createRetirementClock } from "./retirement-clock.ts";

/**
 * Dependencies of `createBadgeDriver`. `universeId` is captured at
 * construction time; `readFile` supplies the icon bytes uploaded on create;
 * `universes` reads the universe owner that sets the payment source of a
 * create.
 *
 * @since 0.4.0
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
	/**
	 * Cloud v2 universes client from `@bedrock-rbx/ocale/universes`. The
	 * driver reads the universe owner on the first create only.
	 */
	readonly universes: UniversesClient;
}

/**
 * A create never offers Robux, so Roblox refuses it once the free quota is
 * spent.
 */
const FREE_CREATE_COST = 0;

type PaymentSourceReader = () => Promise<Result<BadgePaymentSource, OpenCloudError>>;

type OwnerDeps = Pick<BadgeDriverDeps, "universeId" | "universes">;

/**
 * Wraps {@link BadgesClient} as a `ResourceDriver<"badge">`. A create always
 * sends an expected cost of `0` Robux, so Roblox refuses a create the free
 * badge quota does not cover instead of charging for it. The payment source
 * comes from the universe owner (`User` or `Group`), read once on the first
 * create; a failed owner read fails the create. An update sends every managed
 * name, description, and enabled field, and re-uploads the icon only
 * when its file hash changed, recording the uploaded asset ID as
 * `iconImageId`. Retiring renames the badge to `zzz_DEPRECATED(<UTC time>)`,
 * clears its description, disables it, then uploads the placeholder icon.
 * `readCreateCapacity` reads the universe's free badge quota.
 * `list` reads every page of enabled badges as Live state, including their
 * source-language icon IDs and leaving local paths and hashes absent.
 * `read` also finds disabled badges; only an API 404 means missing.
 *
 * Upstream `OpenCloudError` results pass through as `Result` failures.
 * Filesystem errors from `deps.readFile` propagate as promise rejections.
 *
 * @since 0.4.0
 *
 * @param deps - Injected ocale clients, file reader, and owning universe.
 * @returns A driver indexable by `"badge"` in a `DriverRegistry`.
 * @throws Whatever `deps.readFile` rejects with.
 *
 * @example
 *
 * ```ts
 * import { BadgesClient } from "@bedrock-rbx/ocale/badges";
 * import {
 *     createFakeHttpClient,
 *     validBadgeBody,
 *     validUniverseBody,
 * } from "@bedrock-rbx/ocale/testing";
 * import { UniversesClient } from "@bedrock-rbx/ocale/universes";
 * import {
 *     asResourceKey,
 *     asRobloxAssetId,
 *     asSha256Hex,
 *     createBadgeDriver,
 * } from "@bedrock-rbx/core";
 *
 * const httpClient = createFakeHttpClient()
 *     .mockResponse({ body: validUniverseBody({ user: "users/7777" }), status: 200 })
 *     .mockResponse({
 *         body: validBadgeBody({ id: 2_468_013_579, iconImageId: 1_357_924_680 }),
 *         status: 200,
 *     });
 * const credential = { apiKey: "rbx-your-key", kind: "apiKey" } as const;
 *
 * const driver = createBadgeDriver({
 *     client: new BadgesClient({ credential, httpClient, sleep: async () => {} }),
 *     readFile: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
 *     universeId: asRobloxAssetId("1234567890"),
 *     universes: new UniversesClient({ credential, httpClient, sleep: async () => {} }),
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
	const effective = {
		...deps,
		readFile: withRedactedIcon(deps.readFile),
	} satisfies BadgeDriverDeps;
	const paymentSource = memoizedPaymentSource(deps);
	const retirementTime = createRetirementClock();
	return {
		async create(desired) {
			return createBadgeAsync(effective, { desired, readPaymentSource: paymentSource });
		},
		async list() {
			return listBadgesAsync(deps);
		},
		async read(id) {
			return readBadgeAsync(deps, id);
		},
		async readCreateCapacity() {
			return deps.client.getFreeQuota({ universeId: deps.universeId });
		},
		async retire(current) {
			return retireBadgeAsync(effective, { current, now: retirementTime() });
		},
		async update(current, desired) {
			return updateBadgeAsync(effective, { current, desired });
		},
	};
}

function toLiveState(badge: BadgeDetails): ResourceLiveState<"badge"> {
	return {
		name: badge.name,
		description: badge.description,
		enabled: badge.enabled,
		kind: "badge",
		outputs: {
			badgeId: asRobloxAssetId(badge.id),
			...(badge.iconImageId === undefined
				? {}
				: { iconImageId: asRobloxAssetId(badge.iconImageId) }),
		},
	};
}

async function readBadgeAsync(
	deps: BadgeDriverDeps,
	id: RobloxAssetId,
): Promise<Result<ResourceLiveState<"badge"> | undefined, OpenCloudError>> {
	const badge = await deps.client.get({ badgeId: id });
	if (!badge.success) {
		return badge.err instanceof ApiError && badge.err.statusCode === 404
			? { data: undefined, success: true }
			: badge;
	}

	return { data: toLiveState(badge.data), success: true };
}

async function listBadgesAsync(
	deps: BadgeDriverDeps,
): Promise<Result<ReadonlyMap<RobloxAssetId, ResourceLiveState<"badge">>, OpenCloudError>> {
	const badges = new Map<RobloxAssetId, ResourceLiveState<"badge">>();
	let pageToken: string | undefined;
	do {
		const listed = await deps.client.list({
			pageSize: 100,
			universeId: deps.universeId,
			...(pageToken === undefined ? {} : { pageToken }),
		});
		if (!listed.success) {
			return listed;
		}

		for (const badge of listed.data.items) {
			badges.set(asRobloxAssetId(badge.id), toLiveState(badge));
		}

		pageToken = listed.data.nextPageToken;
	} while (pageToken !== undefined);
	return { data: badges, success: true };
}

async function readPaymentSourceAsync(
	deps: OwnerDeps,
): Promise<Result<BadgePaymentSource, OpenCloudError>> {
	const universe = await deps.universes.get({ universeId: deps.universeId });
	if (!universe.success) {
		return universe;
	}

	return { data: universe.data.owner.kind === "group" ? "Group" : "User", success: true };
}

function memoizedPaymentSource(deps: OwnerDeps): PaymentSourceReader {
	let pending: ReturnType<PaymentSourceReader> | undefined;
	return async () => {
		pending ??= readPaymentSourceAsync(deps);
		return pending;
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
	{
		desired,
		readPaymentSource,
	}: {
		readonly desired: BadgeDesiredState;
		readonly readPaymentSource: PaymentSourceReader;
	},
): Promise<Result<ResourceCurrentState<"badge">, OpenCloudError>> {
	const paymentSource = await readPaymentSource();
	if (!paymentSource.success) {
		return paymentSource;
	}

	const icon = await deps.readFile(desired.icon["en-us"]);
	const result = await deps.client.create({
		name: desired.name,
		description: desired.description,
		expectedCost: FREE_CREATE_COST,
		icon,
		isActive: desired.enabled,
		paymentSource: paymentSource.data,
		universeId: deps.universeId,
	});
	if (!result.success) {
		return result;
	}

	return toCurrentState(desired, result.data);
}

async function uploadIconAsync(
	deps: BadgeDriverDeps,
	{ badgeId, path }: { readonly badgeId: RobloxAssetId; readonly path: string },
): Promise<Result<RobloxAssetId, OpenCloudError>> {
	const icon = await deps.readFile(path);
	const uploaded = await deps.client.uploadIcon({ badgeId, icon });
	if (!uploaded.success) {
		return uploaded;
	}

	return { data: asRobloxAssetId(uploaded.data.iconImageId), success: true };
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

	return uploadIconAsync(deps, { badgeId: current.outputs.badgeId, path: desired.icon["en-us"] });
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
	const updated = await deps.client.update({
		name: desired.name,
		badgeId: current.outputs.badgeId,
		description: desired.description,
		enabled: desired.enabled,
	});
	if (!updated.success) {
		return updated;
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

async function retireBadgeAsync(
	deps: BadgeDriverDeps,
	{ current, now }: { readonly current: ResourceCurrentState<"badge">; readonly now: Date },
): Promise<Result<undefined, OpenCloudError>> {
	const { badgeId } = current.outputs;
	const updated = await deps.client.update({
		name: retiredResourceName(now),
		badgeId,
		description: "",
		enabled: false,
	});
	if (!updated.success) {
		return updated;
	}

	const uploaded = await uploadIconAsync(deps, { badgeId, path: REDACTED_ICON_PATH });
	return uploaded.success ? { data: undefined, success: true } : uploaded;
}
