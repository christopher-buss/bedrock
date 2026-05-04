import type { Result } from "@bedrock/ocale";

import { defaultKindRegistry } from "./kinds/index.ts";
import type { BuildDesiredError, ResourceKindModule } from "./kinds/module.ts";
import type { ResourceCurrentState, ResourceDesiredState, ResourceKind } from "./resources.ts";

/**
 * Plan-time invariant check that runs after `buildDesired` and before
 * `diff`. Walks paired `(kind, key)` entries and dispatches to each
 * kind module's optional `assertReconcilable` hook so kind-specific
 * rejections (e.g. Removing a developer-product icon, which the upstream
 * API has no documented unset path for) surface as typed errors before
 * `diff` runs and before any apply-side driver I/O is attempted.
 *
 * Pure and synchronous. Current-only entries (no matching desired) are
 * ignored: their reconciliation is `diff`'s concern, not this seam's.
 *
 * @param desired - Desired state from `buildDesired`.
 * @param current - Prior current state from the state port.
 * @returns `Ok(undefined)` when every paired entry passes its kind-level
 *   reconcilability check, or the first `Err` returned by a hook.
 *
 * @example
 *
 * ```ts
 * import { asResourceKey, asRobloxAssetId, asSha256Hex, validatePlan } from "@bedrock/core";
 *
 * const result = validatePlan(
 *     [
 *         {
 *             description: "Stocks the player up with 1,000 premium gems.",
 *             key: asResourceKey("gem-pack"),
 *             kind: "developerProduct",
 *             name: "Gem Pack",
 *             price: undefined,
 *         },
 *     ],
 *     [
 *         {
 *             description: "Stocks the player up with 1,000 premium gems.",
 *             icon: { "en-us": "assets/gem-pack.png" },
 *             iconFileHashes: {
 *                 "en-us": asSha256Hex(
 *                     "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 *                 ),
 *             },
 *             key: asResourceKey("gem-pack"),
 *             kind: "developerProduct",
 *             name: "Gem Pack",
 *             outputs: { productId: asRobloxAssetId("9876543210") },
 *             price: undefined,
 *         },
 *     ],
 * );
 *
 * expect(result.success).toBeFalse();
 * if (!result.success) {
 *     expect(result.err.kind).toBe("iconRemovalRejected");
 * }
 * ```
 */
export function validatePlan(
	desired: ReadonlyArray<ResourceDesiredState>,
	current: ReadonlyArray<ResourceCurrentState>,
): Result<undefined, BuildDesiredError> {
	const currentByKey = new Map(current.map((entry) => [compositeKey(entry), entry]));
	for (const entry of desired) {
		const matched = currentByKey.get(compositeKey(entry));
		if (matched === undefined) {
			continue;
		}

		const module = defaultKindRegistry[entry.kind] as ResourceKindModule<ResourceKind>;
		const check = module.assertReconcilable?.(matched, entry);
		if (check !== undefined && !check.success) {
			return check;
		}
	}

	return { data: undefined, success: true };
}

function compositeKey(resource: { readonly key: string; readonly kind: ResourceKind }): string {
	return `${resource.kind}:${resource.key}`;
}
