import type { ResourceCurrentState } from "./resources.ts";

/**
 * In-memory state snapshot for one environment.
 *
 * The on-disk JSON wraps this shape with a `$bedrock: { version: N }` envelope.
 * Adapters flatten the envelope on read and re-wrap it on write; nothing
 * outside an adapter sees the `$bedrock` key.
 *
 * `version` is a literal so a breaking schema change is a compile-time type
 * shift rather than a silently accepted runtime value.
 *
 * @example
 *
 * ```ts
 * import {
 *     asResourceKey,
 *     asRobloxAssetId,
 *     asSha256Hex,
 *     type BedrockState,
 * } from "bedrock";
 *
 * const state: BedrockState = {
 *     environment: "production",
 *     resources: [
 *         {
 *             description: "Grants VIP perks.",
 *             iconFileHash: asSha256Hex(
 *                 "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 *             ),
 *             iconFilePath: "assets/vip-icon.png",
 *             key: asResourceKey("vip-pass"),
 *             kind: "gamePass",
 *             name: "VIP Pass",
 *             outputs: {
 *                 assetId: asRobloxAssetId("9876543210"),
 *                 iconAssetId: asRobloxAssetId("1122334455"),
 *             },
 *             price: 500,
 *         },
 *     ],
 *     version: 1,
 * };
 *
 * expect(state.version).toBe(1);
 * expect(state.resources).toHaveLength(1);
 * ```
 */
export interface BedrockState {
	/** Environment name this snapshot belongs to (e.g. `"production"`, `"staging"`). */
	readonly environment: string;
	/** Current state of every resource Bedrock manages in this environment. */
	readonly resources: ReadonlyArray<ResourceCurrentState>;
	/** Schema-version literal; bumped only for breaking changes to the on-disk format. */
	readonly version: 1;
}

/**
 * Failure surfaced by a `StatePort` when a state file exists but cannot be
 * trusted: corrupt JSON, schema failure, or an unknown `$bedrock.version`.
 *
 * Narrow on `kind` rather than using `instanceof`: `StateError` is plain data,
 * not a thrown error subclass.
 *
 * @example
 *
 * ```ts
 * import type { StateError } from "bedrock";
 *
 * const err: StateError = {
 *     file: ".bedrock/state/production.json",
 *     kind: "stateError",
 *     reason: "Corrupt JSON: unexpected token at line 1 column 5",
 * };
 *
 * expect(err.kind).toBe("stateError");
 * ```
 */
export interface StateError {
	/** Adapter-specific path or identifier of the file that failed to parse. */
	readonly file: string;
	/** Literal discriminator for narrowing. */
	readonly kind: "stateError";
	/** Human-readable explanation of why the file could not be trusted. */
	readonly reason: string;
}
