import type { OpenCloudError, Result } from "@bedrock-rbx/ocale";

import type { ResourceLiveState } from "../core/live-state.ts";
import type {
	ResourceCurrentState,
	ResourceDesiredState,
	ResourceKind,
} from "../core/resources.ts";
import type { RobloxAssetId } from "../types/ids.ts";

/**
 * Per-operation context threaded to a driver alongside the desired state.
 * Carries in-memory place artifact bytes and explicit icon restoration
 * instructions through `applyOps`. Artifact bytes override the place file
 * read; forced icons still read effective Desired local or redacted bytes.
 * Drivers ignore context fields they do not consume.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import type { ResourceApplyContext } from "@bedrock-rbx/core";
 *
 * const context: ResourceApplyContext = {
 *     artifact: new Uint8Array([1, 2, 3]), forceIconUpload: true,
 * };
 *
 * expect(context.artifact).toHaveLength(3);
 * expect(context.forceIconUpload).toBe(true);
 * ```
 */
export interface ResourceApplyContext {
	/**
	 * In-memory artifact bytes to publish instead of reading the declared
	 * file.
	 */
	readonly artifact?: Uint8Array;
	/**
	 * Upload the effective Desired source-language icon despite an unchanged
	 * local hash. Ignored by Kinds without local icons and by creates.
	 * @since unreleased
	 */
	readonly forceIconUpload?: boolean;
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
	 * List the universe's Live state, indexed by Roblox ID, without writing.
	 * Unreadable fields (local paths and file hashes) must be absent. Resolve
	 * all pages for passes and products. Badge lists use one anonymous page;
	 * the live check reads tracked badges absent from it through `read`.
	 * @since unreleased
	 *
	 * @example
	 * ```ts
	 * import { asRobloxAssetId, type ResourceDriver } from "@bedrock-rbx/core";
	 *
	 * const id = asRobloxAssetId("123");
	 * const reader: Pick<ResourceDriver<"gamePass">, "list"> = {
	 *     async list() {
	 *         return { data: new Map([[id, {
	 *             kind: "gamePass", name: "VIP", price: 120, outputs: {
	 *             assetId: id },
	 *         }]]), success: true };
	 *     },
	 * };
	 * return reader.list?.().then((result) => {
	 *     expect(result.success).toBeTrue();
	 *     if (result.success) {
	 *         const live = result.data.get(id)!;
	 *         expect(live.price).toBe(120);
	 *         expect("iconFileHashes" in live).toBeFalse();
	 *     }
	 * });
	 * ```
	 */
	list?(): Promise<Result<ReadonlyMap<RobloxAssetId, ResourceLiveState<K>>, OpenCloudError>>;
	/**
	 * Read one resource by Roblox ID. `undefined` means it no longer exists.
	 * An absent method means this Driver cannot read individual resources.
	 * As with {@link ResourceLiveState}, omit unreadable fields and return a
	 * present `undefined` when that is the Live value, such as an off-sale price.
	 * @since unreleased
	 *
	 * @example
	 * ```ts
	 * import {
	 *     asRobloxAssetId, type ResourceDriver, type ResourceLiveState,
	 * } from "@bedrock-rbx/core";
	 *
	 * const id = asRobloxAssetId("123");
	 * const live: ResourceLiveState<"developerProduct"> = {
	 *     kind: "developerProduct",
	 *     outputs: { productId: id }, price: undefined,
	 * };
	 * const items = new Map([[id, live]]);
	 * const reader = {
	 *     async read(id) { return { data: items.get(id), success: true }; },
	 * } satisfies Pick<ResourceDriver<"developerProduct">, "read">;
	 * return Promise.all([
	 *     reader.read(id), reader.read(asRobloxAssetId("999")),
	 * ]).then(([found, missing]) => {
	 *     expect(found).toEqual({ success: true, data: {
	 *         kind: "developerProduct",
	 *         outputs: { productId: id }, price: undefined,
	 *     } });
	 *     expect(missing).toEqual({ success: true, data: undefined });
	 * });
	 * ```
	 */
	read?(id: RobloxAssetId): Promise<Result<ResourceLiveState<K> | undefined, OpenCloudError>>;
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
	 * desired state. Writes every managed scalar field. File inputs normally
	 * upload only when their hashes change; `context.forceIconUpload` restores
	 * a replaced source-language icon from effective Desired bytes instead.
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
