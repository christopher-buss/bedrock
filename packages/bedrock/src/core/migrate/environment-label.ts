import { extractDisplayNamePrefix } from "./extract-display-name-prefix.ts";
import type { EnvironmentFoldResult } from "./fold-environment.ts";

/**
 * Compute the environment-label candidate that round-trips a Mantle-style
 * `[LABEL]` prefix through bedrock's deploy-time prefix system. Inspects
 * every present `displayName` on the env's universe and place folds; if all
 * extractions agree on the same captured label the function returns it
 * lowercased. Any disagreement (mixed prefixes, prefixed alongside
 * unprefixed, or all unprefixed) yields `undefined`, signalling that the
 * caller should keep raw per-environment displayName overrides instead of
 * promoting a label.
 *
 * @param fold - Per-environment fold result to inspect.
 * @returns Lowercased label string when every displayName shares one
 *   bracketed prefix; `undefined` otherwise.
 */
export function computeEnvironmentLabel(fold: EnvironmentFoldResult): string | undefined {
	const labels = new Set<string | undefined>();
	const universeDisplayName = fold.universe?.entry.displayName;
	if (universeDisplayName !== undefined) {
		labels.add(extractDisplayNamePrefix(universeDisplayName).label);
	}

	for (const place of fold.places.values()) {
		const placeDisplayName = place.entry.displayName;
		if (placeDisplayName !== undefined) {
			labels.add(extractDisplayNamePrefix(placeDisplayName).label);
		}
	}

	if (labels.size !== 1) {
		return undefined;
	}

	const [label] = labels;
	return label?.toLowerCase();
}
