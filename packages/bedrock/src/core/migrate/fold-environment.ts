import type { UniverseOutputs } from "../resources.ts";
import type { UniverseEntry } from "../schema.ts";
import { foldPlaces, type PlaceFoldEntry } from "./fold-places.ts";
import { foldUniverse } from "./fold-universe.ts";
import type { MigrationWarning } from "./migration-report.ts";
import type { MantleResource } from "./types.ts";

/**
 * Result of folding one Mantle environment's resource list into bedrock
 * shapes. Each per-kind branch is optional: a Mantle environment without
 * an experience resource yields `universe: undefined`, signalling that
 * the bedrock `Config` for this environment carries no `universe` block.
 *
 * `places` is always present (potentially empty) so the orchestrator does
 * not have to special-case "no places" against "places not yet wired";
 * orphan resources surface as `ambiguous` warnings on `warnings`.
 *
 * Skeleton: universe and place branches are wired. Future slices add
 * `passes` and the deferred / blocked / interpretive warning categories.
 */
export interface EnvironmentFoldResult {
	/** Folded place entries for this environment, keyed by Mantle's place key. */
	readonly places: ReadonlyMap<string, PlaceFoldEntry>;
	/** Folded universe data for this environment, or `undefined` when no experience is present. */
	readonly universe:
		| undefined
		| {
				readonly entry: UniverseEntry;
				readonly outputs: UniverseOutputs;
		  };
	/** Per-rule diagnostics aggregated across all per-kind folds. */
	readonly warnings: ReadonlyArray<MigrationWarning>;
}

/**
 * Orchestrate the per-kind folds for one Mantle environment, gathering
 * the results and warnings into a single `EnvironmentFoldResult`. Pure;
 * delegates to `foldUniverse`, `foldPlaces`, and (in future slices) the
 * matching pass and unsupported folders.
 *
 * @param resources - Mantle resource list for one environment.
 * @returns The folded per-kind data plus aggregated warnings.
 */
export function foldEnvironment(resources: ReadonlyArray<MantleResource>): EnvironmentFoldResult {
	const universeResult = foldUniverse(resources);
	const universe =
		universeResult === undefined
			? undefined
			: { entry: universeResult.entry, outputs: universeResult.outputs };

	const placesResult = foldPlaces(resources);

	const warnings = [...(universeResult?.warnings ?? []), ...placesResult.warnings];

	return { places: placesResult.entries, universe, warnings };
}
