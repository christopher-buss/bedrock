import type { ConfigValidationIssue } from "./config-error.ts";

type Collection = "badges" | "passes" | "places" | "products";

type Collections = Readonly<Partial<Record<Collection, Readonly<Record<string, object>>>>>;

const COLLECTIONS: ReadonlyArray<Collection> = ["passes", "products", "places", "badges"];

/**
 * Reject overlay fields under a root entry marked `retired`. A retired entry
 * carries no other field in any environment, so an overlay may only replace
 * the marker.
 * @param config - Parsed config with validated fields.
 * @returns Issues attributed to the environment and resource entry.
 */
export function collectRetiredOverlayIssues(
	config: Collections & { readonly environments: Readonly<Record<string, Collections>> },
): ReadonlyArray<ConfigValidationIssue> {
	return Object.entries(config.environments).flatMap(([environment, overlay]) => {
		return COLLECTIONS.flatMap((collection) => {
			return Object.entries(overlay[collection] ?? {}).flatMap(([key, entry]) => {
				const root = config[collection]?.[key];
				if (root === undefined || !("retired" in root) || "retired" in entry) {
					return [];
				}

				return [
					{
						message: `${collection}.${key} is retired at the root, so environment "${environment}" may only set retired on it.`,
						path: ["environments", environment, collection, key],
					},
				];
			});
		});
	});
}
