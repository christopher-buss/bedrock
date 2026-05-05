import type { MigrationWarning } from "./migration-report.ts";
import type { MantleResource } from "./types.ts";

/**
 * Mantle resource kinds bedrock plans to support but does not yet model.
 * Maps the wire-form discriminator to the human-readable noun used in
 * each emitted `deferred` warning's `reason`. The reason string is
 * shared across all resources of the same kind.
 */
const DEFERRED_KIND_REASONS: Readonly<Record<string, string>> = {
	assetAlias: "asset aliases",
	audioAsset: "audio assets",
	badge: "badges",
	badgeIcon: "badge icons",
	experienceThumbnail: "experience thumbnails",
	experienceThumbnailOrder: "experience thumbnail ordering",
	imageAsset: "image assets",
	notification: "experience notifications",
	product: "developer products",
	productIcon: "developer-product icons",
};

/**
 * Emit one `deferred` `MigrationWarning` per Mantle resource whose kind
 * bedrock has reserved for a future slice. The warning's `mantlePath` is
 * resource-rooted (`<kind>_<key>`). Resources whose kind is not in the
 * deferred set are passed over silently.
 *
 * @param resources - Mantle resource list for one environment.
 * @returns One warning per deferred-kind resource, in the input order.
 */
export function foldUnsupported(
	resources: ReadonlyArray<MantleResource>,
): ReadonlyArray<MigrationWarning> {
	return resources.flatMap((resource): ReadonlyArray<MigrationWarning> => {
		const humanName = DEFERRED_KIND_REASONS[resource.kind];
		if (humanName === undefined) {
			return [];
		}

		return [
			{
				kind: "deferred",
				mantlePath: `${resource.kind}_${resource.key}`,
				reason: `${humanName}: not yet modeled in bedrock; will surface once the relevant kind ships`,
			},
		];
	});
}
