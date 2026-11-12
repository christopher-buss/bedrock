import { compareLiveState, type LiveSnapshot } from "./live-state.ts";
import type { BedrockState } from "./state.ts";

/**
 * Return new State with readable Live values, without I/O or changing either
 * input. Resource Keys, unreadable fields (including local file paths and
 * hashes), absent Outputs, and State bookkeeping are retained. A present
 * `undefined` replaces the saved value; an absent field leaves it alone.
 *
 * Missing resources and unchecked Kinds keep their saved entries. Untracked
 * Live items are never imported. Use {@link compareLiveState} first when a
 * host needs to report edits or missing resources before accepting Live values.
 * Readable unmanaged fields are included in refreshed resources, even though
 * compare only reports edits to saved managed fields. Persistence and ownership
 * policy belong to the caller.
 *
 * @param state - Saved State for one Environment.
 * @param snapshot - Complete Live lists; an absent Kind was not checked.
 * @returns New State containing the refreshed resource baseline.
 * @since unreleased
 *
 * @example
 * ```ts
 * import {
 *     asResourceKey, asRobloxAssetId, refreshLiveState, type BedrockState,
 * } from "@bedrock-rbx/core";
 *
 * const state: BedrockState = {
 *     environment: "production", version: 1,
 *     resources: [{
 *         key: asResourceKey("gems"), kind: "developerProduct",
 *         name: "Gems", description: "100 gems", price: 100,
 *         outputs: { productId: asRobloxAssetId("123") },
 *     }],
 * };
 * const refreshed = refreshLiveState(state, {
 *     developerProduct: new Map([[asRobloxAssetId("123"), {
 *         kind: "developerProduct", outputs: {}, price: 120,
 *     }]]),
 * });
 * expect(refreshed).toEqual({
 *     ...state, resources: [{ ...state.resources[0], price: 120 }],
 * });
 * expect(refreshed).not.toBe(state);
 * expect(state.resources[0]).toMatchObject({ price: 100 });
 * ```
 */
export function refreshLiveState(state: BedrockState, snapshot: LiveSnapshot): BedrockState {
	return { ...state, resources: compareLiveState(state.resources, snapshot).resources };
}
