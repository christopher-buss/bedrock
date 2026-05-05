import type { EnvironmentEntry, PlaceEntry } from "../schema.ts";
import type { EnvironmentFoldResult } from "./fold-environment.ts";
import type { PlaceFoldEntry } from "./fold-places.ts";

type PlaceOverlayEntry = NonNullable<EnvironmentEntry["places"]>[string];

type OptionalPlaceField = "description" | "displayName" | "serverSize";

interface ConsensusInputs<F extends OptionalPlaceField> {
	readonly field: F;
	readonly folds: ReadonlyArray<EnvironmentFoldResult>;
	readonly placeKey: string;
}

/**
 * Project the per-environment place folds into bedrock's root `places`
 * block, giving each optional metadata field (`description`, `displayName`,
 * `serverSize`) a value only when every environment that owns the place
 * key agrees. Divergent or partially-set fields are omitted from root and
 * surface on each environment's overlay via {@link buildPlacesOverlay}.
 *
 * @param folds - Per-environment fold results, keyed by environment name.
 * @param primaryFold - The chosen primary environment's fold; supplies
 *   `filePath` (required) for every place entry on root.
 * @returns The root `places` block, or `undefined` when the primary has
 *   no place folds.
 */
export function buildRootPlaces(
	folds: ReadonlyMap<string, EnvironmentFoldResult>,
	primaryFold: EnvironmentFoldResult,
): Record<string, PlaceEntry> | undefined {
	if (primaryFold.places.size === 0) {
		return undefined;
	}

	const folded = [...folds.values()];
	return Object.fromEntries(
		[...primaryFold.places.entries()].map(([placeKey, primary]) => [
			placeKey,
			buildRootPlaceEntry(primary, { folds: folded, placeKey }),
		]),
	);
}

/**
 * Build the per-environment overlay for `places`, carrying each field only
 * when the environment's value diverges from the resolved root entry. Fields
 * the environment omits are absent from the overlay so the consumer's
 * defu merge resolves them to the root's (also absent) value rather than
 * overwriting with `undefined`.
 *
 * @param fold - The per-environment fold whose places are being overlaid.
 * @param rootPlaces - The already-built root `places` block; per-place
 *   field values from this map suppress overlay entries that match.
 * @returns The overlay `places` block, or `undefined` when the fold has
 *   no place entries.
 */
export function buildPlacesOverlay(
	fold: EnvironmentFoldResult,
	rootPlaces: Record<string, PlaceEntry> | undefined,
): Record<string, PlaceOverlayEntry> | undefined {
	if (fold.places.size === 0) {
		return undefined;
	}

	return Object.fromEntries(
		[...fold.places.entries()].map(([placeKey, foldEntry]) => [
			placeKey,
			buildPlaceOverlayEntry(foldEntry, rootPlaces?.[placeKey]),
		]),
	);
}

function placeFieldConsensus<F extends OptionalPlaceField>(
	inputs: ConsensusInputs<F>,
): PlaceEntry[F] | undefined {
	const values = inputs.folds.flatMap((fold) => {
		const entry = fold.places.get(inputs.placeKey)?.entry;
		return entry === undefined ? [] : [entry[inputs.field]];
	});

	const [first] = values;
	return values.every((value) => Object.is(first, value)) ? first : undefined;
}

function buildRootPlaceEntry(
	primary: PlaceFoldEntry,
	consensusBase: {
		readonly folds: ReadonlyArray<EnvironmentFoldResult>;
		readonly placeKey: string;
	},
): PlaceEntry {
	const description = placeFieldConsensus({ ...consensusBase, field: "description" });
	const displayName = placeFieldConsensus({ ...consensusBase, field: "displayName" });
	const serverSize = placeFieldConsensus({ ...consensusBase, field: "serverSize" });
	return {
		filePath: primary.entry.filePath,
		...(description !== undefined && { description }),
		...(displayName !== undefined && { displayName }),
		...(serverSize !== undefined && { serverSize }),
	};
}

function buildPlaceOverlayEntry(
	fold: PlaceFoldEntry,
	rootEntry: PlaceEntry | undefined,
): PlaceOverlayEntry {
	const { description, displayName, filePath, serverSize } = fold.entry;
	return {
		placeId: fold.placeId,
		...(filePath !== rootEntry?.filePath && { filePath }),
		...(!Object.is(rootEntry?.description, description) && { description }),
		...(!Object.is(rootEntry?.displayName, displayName) && { displayName }),
		...(!Object.is(rootEntry?.serverSize, serverSize) && { serverSize }),
	};
}
