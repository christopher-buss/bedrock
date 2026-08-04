import type { OpenCloudError } from "@bedrock-rbx/ocale";

import type { ResourceCurrentState, ResourceKind } from "#src/core/resources";
import type { ResourceDriver } from "#src/ports/resource-driver";

/**
 * What a keyed driver fixture answers with for one resource key: a current
 * state resolves as success, an {@link OpenCloudError} as a driver failure.
 *
 * @template Kind - The resource kind the fixture covers.
 */
export type DriverOutcome<Kind extends ResourceKind = ResourceKind> =
	| OpenCloudError
	| ResourceCurrentState<Kind>;

/**
 * Build a driver `create` (or `update`) implementation that answers each
 * desired resource from a fixture table keyed by resource key, so a test that
 * needs one key to fail states that as data instead of branching inside the
 * fake.
 *
 * @template Kind - The resource kind the driver handles.
 * @param byKey - Fixture outcome per resource key.
 * @returns The implementation.
 * @rejects When handed a resource key the table does not cover.
 */
export function outcomeByKey<Kind extends ResourceKind>(
	byKey: Readonly<Record<string, DriverOutcome<Kind>>>,
): NonNullable<ResourceDriver<Kind>["create"]> {
	return async (desired) => {
		const outcome = byKey[desired.key];
		if (outcome === undefined) {
			throw new Error(`no driver fixture for '${desired.key}'`);
		}

		// Resolve on a later microtask, as a real driver round trip does.
		await Promise.resolve();

		return outcome instanceof Error
			? { err: outcome, success: false }
			: { data: outcome, success: true };
	};
}
