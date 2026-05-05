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

	const overlay: Record<string, PlaceOverlayEntry> = {};
	for (const [placeKey, foldEntry] of fold.places) {
		overlay[placeKey] = buildPlaceOverlayEntry(foldEntry, rootPlaces?.[placeKey]);
	}

	return overlay;
}

function placeFieldConsensus<F extends OptionalPlaceField>(
	inputs: ConsensusInputs<F>,
): PlaceEntry[F] | undefined {
	let agreed: PlaceEntry[F] | undefined;
	let hasSeen = false;
	for (const fold of inputs.folds) {
		const entry = fold.places.get(inputs.placeKey)?.entry;
		if (entry === undefined) {
			continue;
		}

		const value = entry[inputs.field];
		if (!hasSeen) {
			agreed = value;
			hasSeen = true;
		} else if (!Object.is(agreed, value)) {
			return undefined;
		}
	}

	return agreed;
}

function buildRootPlaceEntry(
	primary: PlaceFoldEntry,
	consensusBase: {
		readonly folds: ReadonlyArray<EnvironmentFoldResult>;
		readonly placeKey: string;
	},
): PlaceEntry {
	const entry: PlaceEntry = { filePath: primary.entry.filePath };
	const description = placeFieldConsensus({ ...consensusBase, field: "description" });
	if (description !== undefined) {
		entry.description = description;
	}

	const displayName = placeFieldConsensus({ ...consensusBase, field: "displayName" });
	if (displayName !== undefined) {
		entry.displayName = displayName;
	}

	const serverSize = placeFieldConsensus({ ...consensusBase, field: "serverSize" });
	if (serverSize !== undefined) {
		entry.serverSize = serverSize;
	}

	return entry;
}

function buildPlaceOverlayEntry(
	fold: PlaceFoldEntry,
	rootEntry: PlaceEntry | undefined,
): PlaceOverlayEntry {
	const overlay: PlaceOverlayEntry = { placeId: fold.placeId };
	if (fold.entry.filePath !== rootEntry?.filePath) {
		overlay.filePath = fold.entry.filePath;
	}

	const { description, displayName, serverSize } = fold.entry;
	if (!Object.is(rootEntry?.description, description)) {
		overlay.description = description;
	}

	if (!Object.is(rootEntry?.displayName, displayName)) {
		overlay.displayName = displayName;
	}

	if (!Object.is(rootEntry?.serverSize, serverSize)) {
		overlay.serverSize = serverSize;
	}

	return overlay;
}
