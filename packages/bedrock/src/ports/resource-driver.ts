import type { OpenCloudError, Result } from "@bedrock-rbx/ocale";

import type {
	ResourceCurrentState,
	ResourceDesiredState,
	ResourceKind,
} from "../core/resources.ts";

/**
 * Per-operation context threaded to a driver alongside the desired state.
 * Carries in-memory artifact bytes a caller supplies for a place through
 * `applyOps`, overriding the driver's read of the on-disk file; absent (and
 * ignored) on every other dispatch. A driver that does not consume an
 * artifact simply ignores the parameter.
 *
 * @since 0.1.0
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
	/**
	 * In-memory artifact bytes to publish instead of reading the declared
	 * file.
	 */
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
 * @since 0.1.0
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
 *     OpenCloudError,
 * } from "@bedrock-rbx/core";
 *
 * const gamePassDriver: ResourceDriver<"gamePass"> = {
 *     async retire() { return { err: new OpenCloudError("Retirement is not implemented in this example"), success: false }; },
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
	 * Read how many creates the universe can still make free of charge
	 * today, for a Kind Roblox caps per universe. The badge Kind reads its
	 * free badge quota here before any Operation runs. Kinds without a cap
	 * leave this method absent. A badge Driver without it leaves the free
	 * badge quota unknown, so the **Capacity check** treats it as unreadable.
	 *
	 * @since 0.4.0
	 */
	readCreateCapacity?(): Promise<Result<number, OpenCloudError>>;

	/**
	 * Hide the live resource before its state is dropped. Repeated calls must
	 * converge after partial writes. Kinds without retirement support return
	 * an explicit refusal without writing upstream.
	 *
	 * @since 0.4.0
	 */
	retire(current: ResourceCurrentState<K>): Promise<Result<undefined, OpenCloudError>>;

	/**
	 * Optional universe transition capability, used separately from ordinary
	 * reconciliation so the shell can checkpoint and order visibility writes.
	 * Other resource kinds leave this method absent.
	 */
	setVisibility?(
		universeId: string,
		visibility: "private" | "public",
	): Promise<Result<undefined, OpenCloudError>>;

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
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import { OpenCloudError, type DriverRegistry } from "@bedrock-rbx/core";
 *
 * const registry: DriverRegistry = {
 *     badge: {
 *         async retire() { return { err: new OpenCloudError("Retirement is not implemented in this example"), success: false }; },
 *         async create() {
 *             return { err: new OpenCloudError("not implemented"), success: false };
 *         },
 *     },
 *     gamePass: {
 *         async retire() { return { err: new OpenCloudError("Retirement is not implemented in this example"), success: false }; },
 *         async create() {
 *             return { err: new OpenCloudError("not implemented"), success: false };
 *         },
 *     },
 *     place: {
 *         async retire() { return { err: new OpenCloudError("Retirement is not implemented in this example"), success: false }; },
 *         async create() {
 *             return { err: new OpenCloudError("not implemented"), success: false };
 *         },
 *     },
 *     universe: {
 *         async retire() { return { err: new OpenCloudError("Retirement is not implemented in this example"), success: false }; },
 *         async create() {
 *             return { err: new OpenCloudError("not implemented"), success: false };
 *         },
 *     },
 *     developerProduct: {
 *         async retire() { return { err: new OpenCloudError("Retirement is not implemented in this example"), success: false }; },
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
