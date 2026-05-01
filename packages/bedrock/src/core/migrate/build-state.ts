import { asResourceKey, asRobloxAssetId } from "../../types/ids.ts";
import type { ResourceKey, Sha256Hex } from "../../types/ids.ts";
import {
	type ResourceCurrentState,
	UNIVERSE_SINGLETON_KEY,
	type UniverseOutputs,
} from "../resources.ts";
import type { UniverseEntry } from "../schema.ts";
import type { BedrockState } from "../state.ts";
import type { EnvironmentFoldResult } from "./fold-environment.ts";
import type { PassFoldEntry } from "./fold-passes.ts";
import type { PlaceFoldEntry } from "./fold-places.ts";

/**
 * Inputs to {@link buildState}. Bundled into one object because the
 * call site already groups these per-environment values together (the
 * shell threads them in lockstep) and named fields read better than a
 * three-positional-argument signature.
 */
interface BuildStateInputs {
	/** Environment name; written verbatim onto the state. */
	readonly environment: string;
	/** Per-kind fold results for this environment. */
	readonly folded: EnvironmentFoldResult;
	/**
	 * Per-pass-key locale-keyed icon hashes recomputed from disk by the
	 * shell. Keys absent from the map fall back to `mantleIconFileHashes`
	 * from the matching fold entry.
	 */
	readonly iconHashesByKey: ReadonlyMap<ResourceKey, Record<"en-us", Sha256Hex>>;
}

/**
 * Compose one environment's folded data into the on-disk `BedrockState`
 * snapshot the migrator's caller writes per environment.
 *
 * The resulting state carries one `kind: "universe"` resource (when an
 * experience folded), followed by one `kind: "place"` resource per
 * matched place pair, then one `kind: "gamePass"` resource per folded
 * pass entry, in declaration order. Each resource's declared fields
 * mirror its fold output; pass resources receive their `iconFileHashes`
 * from `iconHashesByKey` (computed by the shell from the icon file's
 * bytes) and fall back to the Mantle-recorded hashes when the map omits
 * the key. The `outputs` field carries the Mantle-recorded identifiers
 * (universe `rootPlaceId`, place `versionNumber`, pass `assetId` and
 * `iconAssetIds`).
 *
 * @param inputs - Folded data plus recomputed hashes for this environment.
 * @returns A `BedrockState` populated with one resource per folded kind.
 */
export function buildState(inputs: BuildStateInputs): BedrockState {
	const { environment, folded, iconHashesByKey } = inputs;
	const universeResources: ReadonlyArray<ResourceCurrentState> =
		folded.universe === undefined
			? []
			: [universeResource(folded.universe.entry, folded.universe.outputs)];

	const placeResources: ReadonlyArray<ResourceCurrentState> = [...folded.places.entries()].map(
		([key, entry]) => placeResource(key, entry),
	);

	const passResources: ReadonlyArray<ResourceCurrentState> = folded.passes.map((entry) => {
		return passResource(entry, iconHashesByKey.get(entry.key) ?? entry.mantleIconFileHashes);
	});

	return {
		environment,
		resources: [...universeResources, ...placeResources, ...passResources],
		version: 1,
	};
}

function universeResource(
	entry: UniverseEntry,
	outputs: UniverseOutputs,
): ResourceCurrentState<"universe"> {
	return {
		key: UNIVERSE_SINGLETON_KEY,
		consoleEnabled: entry.consoleEnabled,
		desktopEnabled: entry.desktopEnabled,
		displayName: entry.displayName,
		kind: "universe",
		mobileEnabled: entry.mobileEnabled,
		outputs,
		tabletEnabled: entry.tabletEnabled,
		universeId: asRobloxAssetId(entry.universeId),
		voiceChatEnabled: entry.voiceChatEnabled,
		vrEnabled: entry.vrEnabled,
	};
}

function placeResource(key: string, fold: PlaceFoldEntry): ResourceCurrentState<"place"> {
	return {
		key: asResourceKey(key),
		description: undefined,
		displayName: undefined,
		fileHash: fold.fileHash,
		filePath: fold.entry.filePath,
		kind: "place",
		outputs: fold.outputs,
		placeId: asRobloxAssetId(fold.placeId),
		serverSize: undefined,
	};
}

function passResource(
	fold: PassFoldEntry,
	iconFileHashes: Record<"en-us", Sha256Hex>,
): ResourceCurrentState<"gamePass"> {
	return {
		key: fold.key,
		name: fold.entry.name,
		description: fold.entry.description,
		icon: fold.entry.icon,
		iconFileHashes,
		kind: "gamePass",
		outputs: fold.outputs,
		price: fold.entry.price,
	};
}
