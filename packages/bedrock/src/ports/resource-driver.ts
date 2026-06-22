import type { OpenCloudError, Result } from "@bedrock-rbx/ocale";

import type {
	ResourceCurrentState,
	ResourceDesiredState,
	ResourceKind,
} from "../core/resources.ts";

/**
 * Per-operation context threaded to a driver alongside the desired state.
 * Carries the rebuilt artifact bytes a two-phase deploy's republish stage
 * supplies for a place; absent (and ignored) on every other dispatch. A driver
 * that does not consume an artifact simply ignores the parameter.
 *
 * @example
 *
 * ```ts
 * import type { ResourceApplyContext } from "@bedrock-rbx/core";
 *
 * const context: ResourceApplyContext = { artifact: new Uint8Array([1, 2, 3]) };
 *
 * expect(context.artifact).toHaveLength(3);
 * ```
 */
export interface ResourceApplyContext {
	/** Rebuilt artifact bytes to publish instead of reading the declared file. */
	readonly artifact?: Uint8Array;
}

/**
 * Plugin contract for a resource adapter: the interface a third-party author
 * implements to teach Bedrock how to reconcile one {@link ResourceKind} against
 * its upstream API.
 *
 * `ResourceDriver<K>` is a *driven* (secondary) port in hexagonal terms; the
 * name "driver" follows Terraform, Pulumi, and Mantle IaC convention for a
 * component that talks to a specific resource API.
 *
 * @template K - The {@link ResourceKind} discriminator this driver handles.
 *
 * @example
 *
 * ```ts
 * import {
 *     asResourceKey,
 *     asRobloxAssetId,
 *     asSha256Hex,
 *     type ResourceDriver,
 * } from "@bedrock-rbx/core";
 *
 * const gamePassDriver: ResourceDriver<"gamePass"> = {
 *     async create(desired) {
 *         return {
 *             data: {
 *                 ...desired,
 *                 outputs: {
 *                     assetId: asRobloxAssetId("9876543210"),
 *                     iconAssetIds: { "en-us": asRobloxAssetId("1122334455") },
 *                 },
 *             },
 *             success: true,
 *         };
 *     },
 * };
 *
 * return gamePassDriver
 *     .create({
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
 *         price: undefined,
 *     })
 *     .then((result) => {
 *         expect(result.success).toBeTrue();
 *         if (result.success) {
 *             expect(result.data.outputs.assetId).toBe("9876543210");
 *         }
 *     });
 * ```
 */
export interface ResourceDriver<K extends ResourceKind> {
	/**
	 * Create the resource upstream from its desired state and return the
	 * resulting current state (desired fields + Roblox-assigned outputs).
	 */
	create(
		desired: Extract<ResourceDesiredState, { kind: K }>,
		context?: ResourceApplyContext,
	): Promise<Result<ResourceCurrentState<K>, OpenCloudError>>;

	/**
	 * Reconcile an upstream resource whose managed content has drifted from its
	 * desired state. Receives the last-known current state so the driver can
	 * compute a minimal patch (or no-op upstream, for file-backed kinds where
	 * republishing is unconditional).
	 *
	 * Optional. Drivers whose upstream API has no update operation omit this
	 * method; `applyOps` surfaces an `updateUnsupported` error at dispatch time
	 * instead.
	 */
	update?(
		current: ResourceCurrentState<K>,
		desired: Extract<ResourceDesiredState, { kind: K }>,
		context?: ResourceApplyContext,
	): Promise<Result<ResourceCurrentState<K>, OpenCloudError>>;
}

/**
 * Polymorphic dispatch table keyed by {@link ResourceKind}, mapping each kind
 * to the {@link ResourceDriver} that handles it. `applyOps` indexes the
 * registry by `op.desired.kind` to reach the matching driver with full type
 * safety: adding a new kind to `ResourceDesiredState` is a compile error until
 * a matching registry entry is supplied.
 *
 * @example
 *
 * ```ts
 * import { OpenCloudError, type DriverRegistry } from "@bedrock-rbx/core";
 *
 * const registry: DriverRegistry = {
 *     gamePass: {
 *         async create() {
 *             return { err: new OpenCloudError("not implemented"), success: false };
 *         },
 *     },
 *     place: {
 *         async create() {
 *             return { err: new OpenCloudError("not implemented"), success: false };
 *         },
 *     },
 *     universe: {
 *         async create() {
 *             return { err: new OpenCloudError("not implemented"), success: false };
 *         },
 *     },
 *     developerProduct: {
 *         async create() {
 *             return { err: new OpenCloudError("not implemented"), success: false };
 *         },
 *     },
 * };
 *
 * expect(registry.gamePass).toBeObject();
 * ```
 */
export type DriverRegistry = {
	[K in ResourceKind]: ResourceDriver<K>;
};
