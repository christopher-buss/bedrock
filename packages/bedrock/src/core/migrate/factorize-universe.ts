import type { EnvironmentEntry, UniverseEntry } from "../schema.ts";
import type { EnvironmentFoldResult } from "./fold-environment.ts";

type UniverseOverlay = NonNullable<EnvironmentEntry["universe"]>;

interface UniverseOverlayContext {
	readonly fold: EnvironmentFoldResult;
	readonly hasDivergentUniverseIds: boolean;
}

/**
 * Decide whether a fold map carries more than one distinct universeId,
 * which forces the migrator to omit `universeId` from the root universe
 * block and write it on every environment overlay (the schema-level XOR
 * rule rejects the same `universeId` appearing in both places).
 *
 * @param folds - Per-environment fold results.
 * @returns `true` when at least two folds carry different universeIds.
 */
export function hasDivergentUniverseIds(
	folds: ReadonlyMap<string, EnvironmentFoldResult>,
): boolean {
	const distinctIds = new Set(
		[...folds.values()].flatMap((fold) => {
			return fold.universe === undefined ? [] : [fold.universe.entry.universeId];
		}),
	);
	return distinctIds.size > 1;
}

/**
 * Project the chosen primary environment's universe entry onto bedrock's
 * root `universe` block. Strips `universeId` when universes diverge across
 * environments so the schema-level XOR rule stays satisfied; the per-env
 * overlay carries the id in that case (see {@link buildUniverseOverlay}).
 *
 * @param primaryFold - The chosen primary environment's fold; supplies
 *   the universe entry whose shared fields land on root.
 * @param shouldOmitUniverseId - `true` when universes diverge across the
 *   input fold map (typically the output of {@link hasDivergentUniverseIds}).
 * @returns The root `universe` block, or `undefined` when the primary has
 *   no universe fold or when divergent universes leave nothing to land
 *   at root.
 */
export function buildRootUniverse(
	primaryFold: EnvironmentFoldResult,
	shouldOmitUniverseId: boolean,
): undefined | UniverseEntry {
	const primaryUniverse = primaryFold.universe?.entry;
	if (primaryUniverse === undefined) {
		return undefined;
	}

	if (!shouldOmitUniverseId) {
		return primaryUniverse;
	}

	const { universeId: _omittedUniverseId, ...sharedFields } = primaryUniverse;
	if (Object.keys(sharedFields).length === 0) {
		return undefined;
	}

	return sharedFields;
}

/**
 * Build the per-environment overlay for `universe`. Returns the env's
 * `universeId` when universes diverge across environments (schema-level
 * XOR demands one universeId source per env); otherwise returns
 * `undefined` so the env inherits the root universe block.
 *
 * @param context - The fold to overlay onto and the divergence flag.
 * @returns The overlay, or `undefined` when no per-env overlay is needed.
 */
export function buildUniverseOverlay(context: UniverseOverlayContext): undefined | UniverseOverlay {
	const foldUniverse = context.fold.universe;
	if (foldUniverse === undefined) {
		return undefined;
	}

	if (context.hasDivergentUniverseIds) {
		return { universeId: foldUniverse.entry.universeId };
	}

	return undefined;
}
