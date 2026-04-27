import type { UniverseOutputs } from "../resources.ts";
import type { UniverseEntry } from "../schema.ts";
import { foldUniverse } from "./fold-universe.ts";
import type { MigrationWarning } from "./migration-report.ts";
import type { MantleResource } from "./types.ts";

/**
 * Result of folding one Mantle environment's resource list into bedrock
 * shapes. Each per-kind branch is optional: a Mantle environment without
 * an experience resource yields `universe: undefined`, signalling that
 * the bedrock `Config` for this environment carries no `universe` block.
 *
 * Skeleton: only the universe branch is wired. Future slices add `places`,
 * `passes`, and the deferred / blocked / interpretive warning categories.
 */
export interface EnvironmentFoldResult {
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
 * delegates to `foldUniverse` and (in future slices) the matching place,
 * pass, and unsupported folders.
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

	const warnings = universeResult?.warnings ?? [];

	return { universe, warnings };
}
