import type { OpenCloudError, Result } from "@bedrock/ocale";

import type {
	ResourceCurrentState,
	ResourceDesiredState,
	ResourceKind,
} from "../core/resources.ts";

/**
 * Plugin contract for a resource adapter: the interface a third-party author
 * implements to teach Bedrock how to reconcile one {@link ResourceKind} against
 * its upstream API.
 *
 * `ResourceDriver<K>` is a *driven* (secondary) port in hexagonal terms; the
 * name "driver" follows Terraform, Pulumi, and Mantle IaC convention for a
 * component that talks to a specific resource API. See ADR-018 for the full
 * rationale.
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
 * } from "bedrock";
 *
 * const gamePassDriver: ResourceDriver<"gamePass"> = {
 *     async create(desired) {
 *         return {
 *             data: {
 *                 ...desired,
 *                 outputs: {
 *                     assetId: asRobloxAssetId("9876543210"),
 *                     iconAssetId: asRobloxAssetId("1122334455"),
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
 *         iconFileHash: asSha256Hex(
 *             "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 *         ),
 *         iconFilePath: "assets/vip-icon.png",
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
 * import { OpenCloudError, type DriverRegistry } from "bedrock";
 *
 * const registry: DriverRegistry = {
 *     gamePass: {
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
