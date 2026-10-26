import type { ConfigValidationIssue } from "./config-error.ts";
import { none } from "./none.ts";

interface PricingEntry {
	readonly isManagedPricingEnabled?: boolean;
	readonly price?: number | typeof none;
}

interface PricingCollections {
	readonly passes?: Readonly<Record<string, PricingEntry>>;
	readonly products?: Readonly<Record<string, PricingEntry>>;
}

/**
 * Validate pricing after each environment overlay has been merged. This runs
 * before redaction, so a placeholder price cannot hide an invalid config.
 * @param config - Parsed config with validated fields.
 * @returns Issues attributed to the environment and resource entry.
 */
export function collectManagedPricingIssues(
	config: PricingCollections & {
		readonly environments: Readonly<Record<string, PricingCollections>>;
	},
): ReadonlyArray<ConfigValidationIssue> {
	return Object.entries(config.environments).flatMap(([environment, overlay]) => {
		return (["passes", "products"] as const).flatMap((collection) => {
			const root = config[collection];
			const overrides = overlay[collection];
			return Object.entries({ ...root, ...overrides }).flatMap(([key, value]) => {
				const entry = { ...root?.[key], ...value };
				if (
					entry.isManagedPricingEnabled === true &&
					(entry.price === undefined || entry.price === none)
				) {
					return [
						{
							message: `${collection}.${key} has managed pricing enabled without a price. Set a price or turn managed pricing off.`,
							path: [
								"environments",
								environment,
								collection,
								key,
								"isManagedPricingEnabled",
							],
						},
					];
				}

				return [];
			});
		});
	});
}
