import type { ResourceKey } from "../types/ids.ts";
import type { BedrockState } from "./state.ts";

/**
 * One place artifact a {@link RebuildHook} rebuilt against the freshly minted
 * asset IDs. `key` is the place's resource key; `bytes` is the rebuilt `.rbxl`
 * or `.rbxlx` content the republish stage publishes in place of the file on
 * disk.
 *
 * @example
 *
 * ```ts
 * import { asResourceKey, type RebuiltPlace } from "@bedrock-rbx/core";
 *
 * const rebuilt: RebuiltPlace = {
 *     bytes: new TextEncoder().encode("-- rebuilt place"),
 *     key: asResourceKey("start-place"),
 * };
 *
 * expect(rebuilt.key).toBe("start-place");
 * expect(rebuilt.bytes).toBeInstanceOf(Uint8Array);
 * ```
 */
export interface RebuiltPlace {
	/** Resource key of the place these bytes belong to. */
	readonly key: ResourceKey;
	/** Rebuilt place file bytes to publish for {@link RebuiltPlace.key}. */
	readonly bytes: Uint8Array;
}

/**
 * Caller-supplied hook a two-phase deploy invokes after the asset stage mints
 * new IDs and codegen runs. It receives the post-asset-stage state of the
 * environment being deployed and returns a rebuilt artifact per place to
 * republish. Bedrock publishes each returned entry's `bytes` and clears that
 * place's pending-rebuild marker; the hook owns the build while bedrock owns
 * the orchestration. Supplied programmatically because a function cannot
 * round-trip through a config file.
 *
 * @example
 *
 * ```ts
 * import { asResourceKey, type RebuildHook } from "@bedrock-rbx/core";
 *
 * const rebuild: RebuildHook = ({ state }) => {
 *     const passes = state.resources.filter((resource) => resource.kind === "gamePass");
 *     return [
 *         {
 *             bytes: new TextEncoder().encode(`-- built against ${String(passes.length)} passes`),
 *             key: asResourceKey("start-place"),
 *         },
 *     ];
 * };
 *
 * return Promise.resolve(
 *     rebuild({ state: { environment: "production", resources: [], version: 1 } }),
 * ).then((built) => {
 *     expect(built).toHaveLength(1);
 *     expect(built[0]?.key).toBe("start-place");
 * });
 * ```
 */
export type RebuildHook = (input: {
	readonly state: BedrockState;
}) => Promise<ReadonlyArray<RebuiltPlace>> | ReadonlyArray<RebuiltPlace>;
