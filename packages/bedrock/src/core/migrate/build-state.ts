import { asRobloxAssetId } from "../../types/ids.ts";
import {
	type ResourceCurrentState,
	UNIVERSE_SINGLETON_KEY,
	type UniverseOutputs,
} from "../resources.ts";
import type { UniverseEntry } from "../schema.ts";
import type { BedrockState } from "../state.ts";
import type { EnvironmentFoldResult } from "./fold-environment.ts";

/**
 * Compose one environment's folded data into the on-disk `BedrockState`
 * snapshot the migrator's caller writes per environment.
 *
 * Skeleton: only universe folding is wired. The resulting state carries
 * one `kind: "universe"` resource whose declared fields mirror the folded
 * `UniverseEntry` and whose `outputs` carries the Roblox-assigned
 * `rootPlaceId` recovered from Mantle. Future slices append game-pass and
 * place resources alongside.
 *
 * @param environment - Environment name; written verbatim onto the state.
 * @param folded - Per-kind fold results for this environment.
 * @returns A `BedrockState` populated with one resource per folded kind.
 */
export function buildState(environment: string, folded: EnvironmentFoldResult): BedrockState {
	const resources: ReadonlyArray<ResourceCurrentState> =
		folded.universe === undefined
			? []
			: [universeResource(folded.universe.entry, folded.universe.outputs)];

	return { environment, resources, version: 1 };
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
