import type { Result } from "@bedrock-rbx/ocale";

import type { ResourceKey } from "../types/ids.ts";
import { defaultKindRegistry } from "./kinds/index.ts";
import type { BuildDesiredError, ResourceKindModule } from "./kinds/module.ts";
import type { ResourceCurrentState, ResourceDesiredState, ResourceKind } from "./resources.ts";

/**
 * Batch reconcilability check that runs after `buildDesired` and before
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
 */
export function assertAllReconcilable(
	desired: ReadonlyArray<ResourceDesiredState>,
	current: ReadonlyArray<ResourceCurrentState>,
): Result<undefined, BuildDesiredError> {
	const collision = detectProductNameCollision(desired);
	if (collision !== undefined) {
		return collision;
	}

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

function detectProductNameCollision(
	desired: ReadonlyArray<ResourceDesiredState>,
): Result<undefined, BuildDesiredError> | undefined {
	const seenByName = new Map<string, ResourceKey>();
	for (const entry of desired) {
		if (entry.kind !== "developerProduct") {
			continue;
		}

		const prior = seenByName.get(entry.name);
		if (prior === undefined) {
			seenByName.set(entry.name, entry.key);
			continue;
		}

		return {
			err: {
				keys: [prior, entry.key],
				kind: "redactedNameCollision",
				message: `developer products '${prior}' and '${entry.key}' both resolve to the wire name '${entry.name}'. Roblox enforces per-universe uniqueness on developer-product names, so the second update would be rejected as DuplicateProductName. Set 'redacted: { name: "<unique>" }' on one of them to disambiguate.`,
				resolvedName: entry.name,
			},
			success: false,
		};
	}

	return undefined;
}
