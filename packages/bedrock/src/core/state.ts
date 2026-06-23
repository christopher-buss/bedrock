import type { ResourceKey } from "../types/ids.ts";
import type { ResourceCurrentState, ResourceRealDisplay } from "./resources.ts";

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
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import {
 *     asResourceKey,
 *     asRobloxAssetId,
 *     asSha256Hex,
 *     type BedrockState,
 * } from "@bedrock-rbx/core";
 *
 * const state: BedrockState = {
 *     environment: "production",
 *     resources: [
 *         {
 *             description: "Grants VIP perks.",
 *             icon: { "en-us": "assets/vip-icon.png" },
 *             iconFileHashes: {
 *                 "en-us": asSha256Hex(
 *                     "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 *                 ),
 *             },
 *             key: asResourceKey("vip-pass"),
 *             kind: "gamePass",
 *             name: "VIP Pass",
 *             outputs: {
 *                 assetId: asRobloxAssetId("9876543210"),
 *                 iconAssetIds: { "en-us": asRobloxAssetId("1122334455") },
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
	/**
	 * Place keys recorded as owing a rebuild, surfaced so a later deploy can
	 * self-heal a place that published but never finished its follow-up build.
	 *
	 * Presence-only: a key is either listed or absent, never flagged `false`.
	 * The field is omitted entirely when no place owes a rebuild, so a
	 * happy-path snapshot never carries it. On disk the set is stored as a list
	 * of keys inside the adapter-private `$bedrock` envelope, and an empty set
	 * is dropped on write. The marker never participates in drift detection.
	 */
	readonly pendingRebuild?: ReadonlySet<ResourceKey>;
	/**
	 * Real (pre-redaction) display values for redacted resources, keyed by the
	 * same `kind:key` composite the diff uses. Populated only for resources
	 * that hide a display field; the field is omitted entirely when no resource
	 * is redacted, so a happy-path snapshot never carries it.
	 *
	 * On disk each entry is co-located as an adapter-private `$realDisplay`
	 * sibling on the resource it describes; `serializeStateFile` and
	 * `parseStateFile` own that mapping. The map never participates in drift
	 * detection: `diff` and the state merge operate on the resources array and
	 * never read it, so persisting real values keeps the diff redaction-blind.
	 * A codegen emitter recovers the values through the `codegenView` projection.
	 */
	readonly realDisplay?: Readonly<Record<string, ResourceRealDisplay>>;
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
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import type { StateError } from "@bedrock-rbx/core";
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
