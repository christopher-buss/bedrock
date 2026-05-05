import type { EnvironmentEntry, PlaceEntry } from "../schema.ts";
import { extractDisplayNamePrefix } from "./extract-display-name-prefix.ts";
import type { EnvironmentFoldResult } from "./fold-environment.ts";
import type { PlaceFoldEntry } from "./fold-places.ts";

/**
 * Inputs to {@link buildRootPlaces}.
 */
export interface BuildRootPlacesInputs {
	/** Per-environment fold results, keyed by environment name. */
	readonly folds: ReadonlyMap<string, EnvironmentFoldResult>;
	/**
	 * Per-environment label map. An environment whose label is `undefined`
	 * contributes raw `displayName` values to consensus; otherwise the value
	 * is stripped via {@link extractDisplayNamePrefix} before comparison.
	 */
	readonly labels: ReadonlyMap<string, string | undefined>;
	/** The chosen primary environment's fold; supplies `filePath` for every place entry on root. */
	readonly primaryFold: EnvironmentFoldResult;
}

/**
 * Inputs to {@link buildPlacesOverlay}.
 */
export interface BuildPlacesOverlayInputs {
	/** The per-environment fold whose places are being overlaid. */
	readonly fold: EnvironmentFoldResult;
	/** The environment's label (or `undefined`); enables prefix-stripping on the overlay's `displayName`. */
	readonly label: string | undefined;
	/** The already-built root `places` block; matching field values suppress overlay entries. */
	readonly rootPlaces: Record<string, PlaceEntry> | undefined;
}

type PlaceOverlayEntry = NonNullable<EnvironmentEntry["places"]>[string];

type OptionalPlaceField = "description" | "serverSize";

interface LabeledFold {
	readonly fold: EnvironmentFoldResult;
	readonly label: string | undefined;
}

interface ConsensusInputs<F extends OptionalPlaceField> {
	readonly field: F;
	readonly folds: ReadonlyArray<LabeledFold>;
	readonly placeKey: string;
}

interface DisplayNameConsensusInputs {
	readonly folds: ReadonlyArray<LabeledFold>;
	readonly placeKey: string;
}

interface BuildPlaceOverlayEntryInputs {
	readonly fold: PlaceFoldEntry;
	readonly label: string | undefined;
	readonly rootEntry: PlaceEntry | undefined;
}

/**
 * Project the per-environment place folds into bedrock's root `places`
 * block, giving each optional metadata field (`description`, `displayName`,
 * `serverSize`) a value only when every environment that owns the place
 * key agrees. `displayName` consensus runs on the unprefixed body when an
 * environment carries a label, so a Mantle-stamped `[ENV] Foo` in one
 * environment matches a plain `Foo` in another. Divergent or partially-set
 * fields are omitted from root and surface on each environment's overlay
 * via {@link buildPlacesOverlay}.
 *
 * @param inputs - Per-environment folds, label map, and primary fold.
 * @returns The root `places` block, or `undefined` when the primary has
 *   no place folds.
 */
export function buildRootPlaces(
	inputs: BuildRootPlacesInputs,
): Record<string, PlaceEntry> | undefined {
	const { folds, labels, primaryFold } = inputs;
	if (primaryFold.places.size === 0) {
		return undefined;
	}

	const folded: ReadonlyArray<LabeledFold> = [...folds.entries()].map(([name, fold]) => {
		return { fold, label: labels.get(name) };
	});
	return Object.fromEntries(
		[...primaryFold.places.entries()].map(([placeKey, primary]) => [
			placeKey,
			buildRootPlaceEntry(primary, { folds: folded, placeKey }),
		]),
	);
}

/**
 * Build the per-environment overlay for `places`, carrying each field only
 * when the environment's value diverges from the resolved root entry. When
 * the environment has a label, the overlay stores the unprefixed
 * `displayName` body so the deploy-time prefix system reapplies the bracket
 * cleanly without double-prefixing. Fields the environment omits are absent
 * from the overlay so the consumer's defu merge resolves them to the root's
 * (also absent) value rather than overwriting with `undefined`.
 *
 * @param inputs - Fold, label, and the already-built root `places` block.
 * @returns The overlay `places` block, or `undefined` when the fold has
 *   no place entries.
 */
export function buildPlacesOverlay(
	inputs: BuildPlacesOverlayInputs,
): Record<string, PlaceOverlayEntry> | undefined {
	const { fold, label, rootPlaces } = inputs;
	if (fold.places.size === 0) {
		return undefined;
	}

	return Object.fromEntries(
		[...fold.places.entries()].map(([placeKey, foldEntry]) => {
			return [
				placeKey,
				buildPlaceOverlayEntry({
					fold: foldEntry,
					label,
					rootEntry: rootPlaces?.[placeKey],
				}),
			];
		}),
	);
}

function placeFieldConsensus<F extends OptionalPlaceField>(
	inputs: ConsensusInputs<F>,
): PlaceEntry[F] | undefined {
	const values = inputs.folds.flatMap(({ fold }) => {
		const entry = fold.places.get(inputs.placeKey)?.entry;
		return entry === undefined ? [] : [entry[inputs.field]];
	});

	const [first] = values;
	return values.every((value) => Object.is(first, value)) ? first : undefined;
}

function resolveDisplayName(
	displayName: string | undefined,
	label: string | undefined,
): string | undefined {
	if (displayName === undefined || label === undefined) {
		return displayName;
	}

	return extractDisplayNamePrefix(displayName).body;
}

function displayNameConsensus(inputs: DisplayNameConsensusInputs): string | undefined {
	const values = inputs.folds.flatMap(({ fold, label }): ReadonlyArray<string | undefined> => {
		const entry = fold.places.get(inputs.placeKey)?.entry;
		return entry === undefined ? [] : [resolveDisplayName(entry.displayName, label)];
	});

	const [first] = values;
	return values.every((value) => Object.is(first, value)) ? first : undefined;
}

function buildRootPlaceEntry(
	primary: PlaceFoldEntry,
	consensusBase: {
		readonly folds: ReadonlyArray<LabeledFold>;
		readonly placeKey: string;
	},
): PlaceEntry {
	const description = placeFieldConsensus({ ...consensusBase, field: "description" });
	const displayName = displayNameConsensus(consensusBase);
	const serverSize = placeFieldConsensus({ ...consensusBase, field: "serverSize" });
	return {
		filePath: primary.entry.filePath,
		...(description !== undefined && { description }),
		...(displayName !== undefined && { displayName }),
		...(serverSize !== undefined && { serverSize }),
	};
}

function buildPlaceOverlayEntry(inputs: BuildPlaceOverlayEntryInputs): PlaceOverlayEntry {
	const { fold, label, rootEntry } = inputs;
	const { description, displayName: rawDisplayName, filePath, serverSize } = fold.entry;
	const displayName = resolveDisplayName(rawDisplayName, label);
	return {
		placeId: fold.placeId,
		...(filePath !== rootEntry?.filePath && { filePath }),
		...(!Object.is(rootEntry?.description, description) && { description }),
		...(!Object.is(rootEntry?.displayName, displayName) && { displayName }),
		...(!Object.is(rootEntry?.serverSize, serverSize) && { serverSize }),
	};
}
