import type { EnvironmentEntry, UniverseEntry } from "../schema.ts";
import type { EnvironmentFoldResult } from "./fold-environment.ts";

/**
 * Universe fields whose values differ across environments. A divergent
 * field is omitted from the root `universe` block and written on each
 * environment's overlay instead.
 */
export interface UniverseDivergence {
	/** `true` when environments declare different experience icons. */
	readonly icon: boolean;
	/** `true` when environments target different universes. */
	readonly universeId: boolean;
}

type UniverseOverlay = NonNullable<EnvironmentEntry["universe"]>;

interface UniverseOverlayContext {
	readonly divergence: UniverseDivergence;
	readonly fold: EnvironmentFoldResult;
}

/**
 * Find the universe fields that differ across the environments of a fold
 * map.
 *
 * @param folds - Per-environment fold results.
 * @returns The divergence of each field that factorization splits.
 */
export function detectUniverseDivergence(
	folds: ReadonlyMap<string, EnvironmentFoldResult>,
): UniverseDivergence {
	return { icon: hasDivergentUniverseIcons(folds), universeId: hasDivergentUniverseIds(folds) };
}

/**
 * Project the chosen primary environment's universe entry onto bedrock's
 * root `universe` block. Strips each divergent field (`universeId`,
 * `icon`) so every environment resolves its own value from its overlay;
 * stripping `universeId` also keeps the schema-level XOR rule satisfied
 * (see {@link buildUniverseOverlay}).
 *
 * @param primaryFold - The chosen primary environment's fold; supplies
 *   the universe entry whose shared fields land on root.
 * @param divergence - Fields that differ across the input fold map.
 * @returns The root `universe` block, or `undefined` when the primary has
 *   no universe fold or when divergent fields leave nothing to land at
 *   root.
 */
export function buildRootUniverse(
	primaryFold: EnvironmentFoldResult,
	divergence: UniverseDivergence,
): undefined | UniverseEntry {
	const primaryUniverse = primaryFold.universe?.entry;
	if (primaryUniverse === undefined) {
		return undefined;
	}

	const { icon, universeId, ...sharedFields } = primaryUniverse;
	const root: UniverseEntry = {
		...sharedFields,
		...(icon === undefined || divergence.icon ? {} : { icon }),
		...(divergence.universeId ? {} : { universeId }),
	};
	return Object.keys(root).length === 0 ? undefined : root;
}

/**
 * Build the per-environment overlay for `universe`. Carries the env's
 * `universeId` when universes diverge across environments (schema-level
 * XOR demands one universeId source per env), and the env's `icon` when
 * icons diverge and the env declares one. Returns `undefined` when neither
 * applies so the env inherits the root universe block.
 *
 * @param context - The fold to overlay onto and the divergent fields.
 * @returns The overlay, or `undefined` when no per-env overlay is needed.
 */
export function buildUniverseOverlay(context: UniverseOverlayContext): undefined | UniverseOverlay {
	const foldUniverse = context.fold.universe;
	if (foldUniverse === undefined) {
		return undefined;
	}

	const { icon, universeId } = foldUniverse.entry;
	const { divergence } = context;
	const overlay: UniverseOverlay = {
		...(icon !== undefined && divergence.icon ? { icon } : {}),
		...(divergence.universeId ? { universeId } : {}),
	};
	return Object.keys(overlay).length === 0 ? undefined : overlay;
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
function hasDivergentUniverseIds(folds: ReadonlyMap<string, EnvironmentFoldResult>): boolean {
	const distinctIds = new Set(
		[...folds.values()].flatMap((fold) => {
			return fold.universe === undefined ? [] : [fold.universe.entry.universeId];
		}),
	);
	return distinctIds.size > 1;
}

/**
 * Decide whether the environments of a fold map declare different
 * experience icons. An environment without an icon counts as a distinct
 * value, so an icon that only some environments declare also diverges:
 * hoisting it to root would make the others upload it on their first
 * deploy.
 *
 * @param folds - Per-environment fold results.
 * @returns `true` when at least two universe folds carry different icons.
 */
function hasDivergentUniverseIcons(folds: ReadonlyMap<string, EnvironmentFoldResult>): boolean {
	const distinctPaths = new Set(
		[...folds.values()].flatMap(({ universe }) => {
			if (universe === undefined) {
				return [];
			}

			const { icon } = universe.entry;
			return [typeof icon === "object" ? icon["en-us"] : icon];
		}),
	);
	return distinctPaths.size > 1;
}
