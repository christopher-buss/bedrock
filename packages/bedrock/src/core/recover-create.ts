import type { RobloxAssetId } from "../types/ids.ts";
import type { ResourceLiveState } from "./live-state.ts";
import type {
	BadgeDesiredState,
	DeveloperProductDesiredState,
	GamePassDesiredState,
	ResourceCurrentState,
	ResourceKind,
} from "./resources.ts";

/**
 * The live lists a failed create is matched against.
 * @template K - Kind of the failed create.
 */
export interface RecoveryLists<K extends ResourceKind> {
	/** The list read again after the create failed. */
	readonly after: ReadonlyMap<RobloxAssetId, ResourceLiveState<K>>;
	/** The list read before Apply. */
	readonly before: ReadonlyMap<RobloxAssetId, ResourceLiveState<K>>;
	/** IDs this run already recorded for another create. */
	readonly claimed: ReadonlySet<RobloxAssetId>;
}

/**
 * Recover a failed game-pass create from the one new pass with its name.
 * @param desired - The desired state the failed create sent.
 * @param lists - The live lists before Apply and after the failure.
 * @returns The recovered Current state, or `undefined` when no single new
 *   pass has the name or the pass has no icon.
 */
export function recoverGamePass(
	desired: GamePassDesiredState,
	lists: RecoveryLists<"gamePass">,
): ResourceCurrentState<"gamePass"> | undefined {
	const found = onlyNewItemNamed(desired.name, lists);
	const icon = found?.[1].outputs.iconAssetIds?.["en-us"];
	if (found === undefined || icon === undefined) {
		return undefined;
	}

	const [assetId, { kind: _kind, outputs: _outputs, ...fields }] = found;
	return { ...desired, ...fields, outputs: { assetId, iconAssetIds: { "en-us": icon } } };
}

/**
 * Recover a failed developer-product create from the one new product with
 * its name.
 * @param desired - The desired state the failed create sent.
 * @param lists - The live lists before Apply and after the failure.
 * @returns The recovered Current state, or `undefined` when no single new
 *   product has the name or it lacks the icon the config declares.
 */
export function recoverDeveloperProduct(
	desired: DeveloperProductDesiredState,
	lists: RecoveryLists<"developerProduct">,
): ResourceCurrentState<"developerProduct"> | undefined {
	const found = onlyNewItemNamed(desired.name, lists);
	const iconImageAssetId = found?.[1].outputs.iconImageAssetId;
	if (found === undefined || (iconImageAssetId === undefined && desired.icon !== undefined)) {
		return undefined;
	}

	const [productId, { kind: _kind, outputs: _outputs, ...fields }] = found;
	return {
		...desired,
		...fields,
		outputs: { productId, ...(iconImageAssetId === undefined ? {} : { iconImageAssetId }) },
	};
}

/**
 * Recover a failed badge create from the one new badge with its name.
 * @param desired - The desired state the failed create sent.
 * @param lists - The live lists before Apply and after the failure.
 * @returns The recovered Current state, or `undefined` when no single new
 *   badge has the name or the badge has no icon.
 */
export function recoverBadge(
	desired: BadgeDesiredState,
	lists: RecoveryLists<"badge">,
): ResourceCurrentState<"badge"> | undefined {
	const found = onlyNewItemNamed(desired.name, lists);
	const iconImageId = found?.[1].outputs.iconImageId;
	if (found === undefined || iconImageId === undefined) {
		return undefined;
	}

	const [badgeId, { kind: _kind, outputs: _outputs, ...fields }] = found;
	return { ...desired, ...fields, outputs: { badgeId, iconImageId } };
}

function onlyNewItemNamed<K extends "badge" | "developerProduct" | "gamePass">(
	name: string,
	{ after, before, claimed }: RecoveryLists<K>,
): readonly [RobloxAssetId, ResourceLiveState<K>] | undefined {
	const candidates = [...after].filter(([id, live]) => {
		return !before.has(id) && !claimed.has(id) && live.name === name;
	});
	return candidates.length === 1 ? candidates[0] : undefined;
}
