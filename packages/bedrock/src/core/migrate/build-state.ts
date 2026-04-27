import { asResourceKey, asRobloxAssetId } from "../../types/ids.ts";
import {
	type ResourceCurrentState,
	UNIVERSE_SINGLETON_KEY,
	type UniverseOutputs,
} from "../resources.ts";
import type { UniverseEntry } from "../schema.ts";
import type { BedrockState } from "../state.ts";
import type { EnvironmentFoldResult } from "./fold-environment.ts";
import type { PlaceFoldEntry } from "./fold-places.ts";

/**
 * Compose one environment's folded data into the on-disk `BedrockState`
 * snapshot the migrator's caller writes per environment.
 *
 * Skeleton: universe and place folds are wired. The resulting state
 * carries one `kind: "universe"` resource (when an experience folded) and
 * one `kind: "place"` resource per matched place pair, in declaration
 * order. Each resource's declared fields mirror its fold output and the
 * `outputs` field carries the Mantle-recorded identifiers (universe
 * `rootPlaceId`, place `versionNumber`). Future slices append game-pass
 * resources alongside.
 *
 * @param environment - Environment name; written verbatim onto the state.
 * @param folded - Per-kind fold results for this environment.
 * @returns A `BedrockState` populated with one resource per folded kind.
 */
export function buildState(environment: string, folded: EnvironmentFoldResult): BedrockState {
	const universeResources: ReadonlyArray<ResourceCurrentState> =
		folded.universe === undefined
			? []
			: [universeResource(folded.universe.entry, folded.universe.outputs)];

	const placeResources: ReadonlyArray<ResourceCurrentState> = [...folded.places.entries()].map(
		([key, entry]) => placeResource(key, entry),
	);

	return {
		environment,
		resources: [...universeResources, ...placeResources],
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
		visibility: entry.visibility,
		voiceChatEnabled: entry.voiceChatEnabled,
		vrEnabled: entry.vrEnabled,
	};
}

function placeResource(key: string, fold: PlaceFoldEntry): ResourceCurrentState<"place"> {
	return {
		key: asResourceKey(key),
		fileHash: fold.fileHash,
		filePath: fold.entry.filePath,
		kind: "place",
		outputs: fold.outputs,
		placeId: asRobloxAssetId(fold.placeId),
	};
}
