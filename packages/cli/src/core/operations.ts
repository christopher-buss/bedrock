import type { ResourceKey } from "../types/ids.ts";
import type { ResourceCurrentState, ResourceDesiredState } from "./resources.ts";

/**
 * Reconcile an absent resource: produced when a `desired` entry has no
 * matching `current` entry. The driver creates the resource and records the
 * Roblox-assigned outputs into state.
 *
 * @example
 *
 * ```ts
 * import {
 *     asResourceKey,
 *     asSha256Hex,
 *     type CreateOperation,
 * } from "bedrock";
 *
 * const op: CreateOperation = {
 *     desired: {
 *         description: "Grants VIP perks.",
 *         iconFileHash: asSha256Hex(
 *             "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 *         ),
 *         iconFilePath: "assets/vip-icon.png",
 *         key: asResourceKey("vip-pass"),
 *         kind: "gamePass",
 *         name: "VIP Pass",
 *         price: 500,
 *     },
 *     key: asResourceKey("vip-pass"),
 *     type: "create",
 * };
 *
 * expect(op.type).toBe("create");
 * expect(op.desired.kind).toBe("gamePass");
 * ```
 */
export interface CreateOperation extends BaseOperation {
	/** Declared desired state to materialize through the driver. */
	readonly desired: ResourceDesiredState;
	/** Discriminator tag for the `Operation` union. */
	readonly type: "create";
}

/**
 * Reconcile a drifted resource: produced when a `desired` entry differs from
 * its matching `current` entry. Both states are carried so the driver can
 * compute the minimal patch.
 *
 * Defined in slice 1 for type completeness, but not yet handled at apply time:
 * `applyOps` returns an `unsupported` error when it encounters one until a
 * driver wires up update support in a later slice.
 *
 * @example
 *
 * ```ts
 * import {
 *     asResourceKey,
 *     asRobloxAssetId,
 *     asSha256Hex,
 *     type UpdateOperation,
 * } from "bedrock";
 *
 * const op: UpdateOperation = {
 *     current: {
 *         description: "Grants VIP perks.",
 *         iconFileHash: asSha256Hex(
 *             "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 *         ),
 *         iconFilePath: "assets/vip-icon.png",
 *         key: asResourceKey("vip-pass"),
 *         kind: "gamePass",
 *         name: "VIP Pass",
 *         outputs: {
 *             assetId: asRobloxAssetId("9876543210"),
 *             iconAssetId: asRobloxAssetId("1122334455"),
 *         },
 *         price: 500,
 *     },
 *     desired: {
 *         description: "Grants VIP perks plus emote.",
 *         iconFileHash: asSha256Hex(
 *             "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 *         ),
 *         iconFilePath: "assets/vip-icon.png",
 *         key: asResourceKey("vip-pass"),
 *         kind: "gamePass",
 *         name: "VIP Pass",
 *         price: 750,
 *     },
 *     key: asResourceKey("vip-pass"),
 *     type: "update",
 * };
 *
 * expect(op.type).toBe("update");
 * expect(op.desired.price).toBe(750);
 * expect(op.current.outputs.assetId).toBe("9876543210");
 * ```
 */
export interface UpdateOperation extends BaseOperation {
	/** Last-known live state; the driver computes a patch against `desired`. */
	readonly current: ResourceCurrentState;
	/** Declared desired state to converge toward. */
	readonly desired: ResourceDesiredState;
	/** Discriminator tag for the `Operation` union. */
	readonly type: "update";
}

/**
 * Acknowledge that a resource is already in sync: produced when a `desired`
 * entry matches its `current` entry exactly. The driver performs no I/O for
 * this variant.
 *
 * Bare by design: the operation carries only `key` and `type` because no
 * payload is needed at apply time. Callers that need the matching desired or
 * current state look it up in the snapshots passed to `diff`.
 *
 * @example
 *
 * ```ts
 * import { asResourceKey, type NoopOperation } from "bedrock";
 *
 * const op: NoopOperation = {
 *     key: asResourceKey("vip-pass"),
 *     type: "noop",
 * };
 *
 * expect(op.type).toBe("noop");
 * expect(op.key).toBe("vip-pass");
 * ```
 */
export interface NoopOperation extends BaseOperation {
	/** Discriminator tag for the `Operation` union. */
	readonly type: "noop";
}

/**
 * Discriminated union of every reconciliation step `diff` produces and
 * `applyOps` consumes. The `type` field is the discriminator (`kind` is
 * reserved for the resource discriminator in `ResourceDesiredState`).
 *
 * Slice 1 ships three variants. A `delete` variant is intentionally absent:
 * resources removed from config are not reconciled until a future slice
 * introduces orphan handling. The `Operation` union is the canonical
 * statement of that product boundary.
 *
 * @example
 *
 * ```ts
 * import { asResourceKey, type Operation } from "bedrock";
 *
 * function describeOp(op: Operation): string {
 *     switch (op.type) {
 *         case "create": {
 *             return `create ${op.desired.kind} ${op.key}`;
 *         }
 *         case "update": {
 *             return `update ${op.desired.kind} ${op.key}`;
 *         }
 *         case "noop": {
 *             return `noop ${op.key}`;
 *         }
 *     }
 * }
 *
 * const op: Operation = {
 *     key: asResourceKey("vip-pass"),
 *     type: "noop",
 * };
 *
 * expect(describeOp(op)).toBe("noop vip-pass");
 * ```
 */
export type Operation = CreateOperation | NoopOperation | UpdateOperation;

/**
 * Fields shared by every operation variant.
 *
 * `key` is hoisted to op-level (rather than nested under `desired` or
 * `current`) so callers can read it from any variant without first narrowing
 * on the discriminator. `applyOps` and logging both rely on this uniform
 * access pattern.
 */
interface BaseOperation {
	/** Resource key copied from the desired or current entry the op describes. */
	readonly key: ResourceKey;
}
