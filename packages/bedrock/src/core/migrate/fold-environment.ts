import type { UniverseOutputs } from "../resources.ts";
import type { UniverseEntry } from "../schema.ts";
import { foldPasses, type PassFoldEntry } from "./fold-passes.ts";
import { foldPlaces, type PlaceFoldEntry } from "./fold-places.ts";
import { foldUniverse } from "./fold-universe.ts";
import { foldUnsupported } from "./fold-unsupported.ts";
import type { MigrationWarning } from "./migration-report.ts";
import type { MantleResource } from "./types.ts";

/**
 * Result of folding one Mantle environment's resource list into bedrock
 * shapes. A Mantle environment without an experience resource yields
 * `universe: undefined`, signalling that the bedrock `Config` for this
 * environment carries no `universe` block. `places` and `passes` are
 * always present (potentially empty) so the orchestrator does not have
 * to special-case "no <kind>" against "<kind> not yet wired"; orphan
 * place resources surface as `ambiguous` warnings, and resources of
 * kinds bedrock plans to support but does not yet model surface as
 * `deferred` warnings.
 */
export interface EnvironmentFoldResult {
	/** Folded pass entries for this environment, in declaration order. */
	readonly passes: ReadonlyArray<PassFoldEntry>;
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
 * delegates to `foldUniverse`, `foldPlaces`, `foldPasses`, and
 * `foldUnsupported`. Emitted warning paths are resource-rooted.
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
	const passesResult = foldPasses(resources);

	const warnings = [
		...(universeResult?.warnings ?? []),
		...placesResult.warnings,
		...passesResult.warnings,
		...foldUnsupported(resources),
	];

	return {
		passes: passesResult.passes,
		places: placesResult.entries,
		universe,
		warnings,
	};
}
