import type { OpenCloudError, Result } from "@bedrock/ocale";

import type { Operation } from "../core/operations.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";
import type { ResourceKey } from "../types/ids.ts";

/**
 * Failure surfaced by `applyOps` when an operation cannot be applied.
 * Plain-data discriminated union following the `StateError` pattern in
 * `core/state.ts`; narrow on `kind`, do not `instanceof` it.
 */
export type ApplyError =
	| {
			readonly cause: OpenCloudError;
			readonly key: ResourceKey;
			readonly kind: "driverFailure";
	  }
	| {
			readonly key: ResourceKey;
			readonly kind: "updateUnsupported";
	  };

/**
 * Dispatch each reconciliation operation to the matching resource driver
 * with first-fail semantics: on the first `Err` (driver failure or
 * `updateUnsupported`), the remaining operations are skipped and the error
 * is returned verbatim.
 *
 * Behaviour:
 * - `create` operations are routed to `registry[op.desired.kind].create`.
 * - `update` operations short-circuit to an `updateUnsupported` Err;
 *   no driver is invoked.
 * - `noop` operations are skipped entirely (no I/O, no dispatch).
 * @param ops - Reconciliation operations produced by `diff`, applied in order.
 * @param registry - Per-kind driver table; dispatch uses `op.desired.kind` as the index.
 * @returns `Ok(undefined)` when every operation succeeds, or the first failure encountered.
 */
export async function applyOps(
	ops: ReadonlyArray<Operation>,
	registry: DriverRegistry,
): Promise<Result<undefined, ApplyError>> {
	for (const op of ops) {
		if (op.type === "noop") {
			continue;
		}

		if (op.type === "update") {
			return {
				err: { key: op.key, kind: "updateUnsupported" },
				success: false,
			};
		}

		const driver = registry[op.desired.kind];
		const result = await driver.create(op.desired);
		if (!result.success) {
			return {
				err: { key: op.key, cause: result.err, kind: "driverFailure" },
				success: false,
			};
		}
	}

	return { data: undefined, success: true };
}
