import { type BlockedFieldRule, blockedWarning, isObjectPayload } from "./fold-universe-shared.ts";
import type { MigrationWarning } from "./migration-report.ts";
import type { MantleResource } from "./types.ts";

const PLACE_CONFIGURATION_KIND = "placeConfiguration";

/**
 * `placeConfiguration_<k>` fields with no Open Cloud writable endpoint.
 * `name`, `description`, and `maxPlayerCount` are intentionally omitted:
 * `foldDisplayName` and `foldPlaces` fold them into the bedrock config.
 */
const BLOCKED_FIELDS: ReadonlyArray<BlockedFieldRule> = [
	{
		field: "allowCopying",
		reason: "placeConfiguration.allowCopying has no Open Cloud equivalent",
	},
	{
		field: "socialSlotType",
		reason: "placeConfiguration social-slot config has no Open Cloud equivalent",
	},
	{
		field: "customSocialSlotsCount",
		reason: "placeConfiguration social-slot config has no Open Cloud equivalent",
	},
];

/**
 * Emit one `blocked` `MigrationWarning` per non-`undefined` legacy-only
 * field on every `placeConfiguration_<k>` resource. The Mantle null
 * sentinel (`~`) is normalized to `undefined` by `parseState`, so absent
 * and null fields both skip.
 *
 * @param resources - Mantle resource list for one environment.
 * @returns One warning per blocked field present, ordered by resource
 *   list then by the static field table.
 */
export function foldBlockedPlaceFields(
	resources: ReadonlyArray<MantleResource>,
): ReadonlyArray<MigrationWarning> {
	return resources.flatMap((resource) => {
		if (resource.kind !== PLACE_CONFIGURATION_KIND || !isObjectPayload(resource.inputs)) {
			return [];
		}

		const { key, inputs } = resource;
		return BLOCKED_FIELDS.flatMap((rule) => {
			if (inputs[rule.field] === undefined) {
				return [];
			}

			return [
				blockedWarning(`${PLACE_CONFIGURATION_KIND}_${key}.${rule.field}`, rule.reason),
			];
		});
	});
}
