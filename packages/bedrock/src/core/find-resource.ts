import type { ResourceCurrentState, ResourceKind } from "./resources.ts";

/**
 * Find a resource by kind (and optional key) in a resources array, narrowed to
 * that kind so its `outputs` and kind-specific fields are typed without a
 * hand-written guard. With a `key` the match is exact (kind and key);
 * without one the first resource of the kind is returned. Returns `undefined`
 * when no resource matches.
 *
 * Intended for codegen emitters and other readers of `BedrockState.resources`
 * that need a single resource by kind (and optionally key) rather than
 * re-deriving `resources.find((resource) => resource.kind === kind)` with a
 * manual type predicate at every call site.
 *
 * @since 0.1.0
 *
 * @template K - The {@link ResourceKind} to narrow the result to.
 * @param resources - The resources to search (e.g. `state.resources`).
 * @param selector - The kind to match and an optional key.
 * @returns The matching resource narrowed to `K`, or `undefined`.
 *
 * @example
 *
 * ```ts
 * import {
 *     asResourceKey,
 *     asRobloxAssetId,
 *     asSha256Hex,
 *     findResource,
 *     type ResourceCurrentState,
 * } from "@bedrock-rbx/core";
 *
 * const resources: ReadonlyArray<ResourceCurrentState> = [
 *     {
 *         description: "Grants VIP perks.",
 *         icon: { "en-us": "assets/vip-icon.png" },
 *         iconFileHashes: {
 *             "en-us": asSha256Hex(
 *                 "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 *             ),
 *         },
 *         key: asResourceKey("vip-pass"),
 *         kind: "gamePass",
 *         name: "VIP Pass",
 *         outputs: {
 *             assetId: asRobloxAssetId("9876543210"),
 *             iconAssetIds: { "en-us": asRobloxAssetId("1122334455") },
 *         },
 *         price: 500,
 *     },
 * ];
 *
 * const pass = findResource(resources, { key: "vip-pass", kind: "gamePass" });
 * // `pass` is narrowed to ResourceCurrentState<"gamePass">, so `outputs.assetId` is typed.
 * expect(pass?.outputs.assetId).toBe("9876543210");
 * expect(findResource(resources, { kind: "place" })).toBeUndefined();
 * ```
 */
export function findResource<K extends ResourceKind>(
	resources: ReadonlyArray<ResourceCurrentState>,
	selector: { readonly key?: string | undefined; readonly kind: K },
): ResourceCurrentState<K> | undefined {
	const { key, kind } = selector;
	return resources.find((resource): resource is ResourceCurrentState<K> => {
		return resource.kind === kind && (key === undefined || resource.key === key);
	});
}
