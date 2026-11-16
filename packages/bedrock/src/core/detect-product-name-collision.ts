import type { Result } from "@bedrock-rbx/ocale";

import type { ResourceKey } from "../types/ids.ts";
import type { RetiredInput } from "./flatten.ts";
import type { BuildDesiredError } from "./kinds/module.ts";
import type { ResourceDesiredState } from "./resources.ts";

/**
 * Pre-diff check that no two developer products in one batch resolve to the
 * same wire `name`. Roblox enforces per-universe uniqueness on
 * developer-product names, so the second update would be rejected with
 * `DuplicateProductName`; surfacing it here fails before any driver I/O.
 *
 * Pure and synchronous. Retired entries and other kinds are ignored.
 *
 * @param desired - Desired state from `buildDesired`.
 * @returns `Ok(undefined)` when every developer-product name is unique, or a
 *   `redactedNameCollision` error naming the first colliding pair.
 */
export function detectProductNameCollision(
	desired: ReadonlyArray<ResourceDesiredState | RetiredInput>,
): Result<undefined, BuildDesiredError> {
	const seenByName = new Map<string, ResourceKey>();
	for (const entry of desired) {
		if ("retired" in entry || entry.kind !== "developerProduct") {
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

	return { data: undefined, success: true };
}
