import type { Result } from "@bedrock-rbx/ocale";

import { assertAllReconcilable } from "./assert-all-reconcilable.ts";
import { diffRebound } from "./diff.ts";
import type { ResourceDesiredInput, RetiredInput } from "./flatten.ts";
import type { BuildDesiredError } from "./kinds/module.ts";
import type { Operation } from "./operations.ts";
import { rebindCurrent } from "./rebind-current.ts";
import type { ResourceDesiredState } from "./resources.ts";
import type { OrphanPolicy } from "./schema.ts";
import type { BedrockState } from "./state.ts";

type Baseline = Pick<BedrockState, "pendingRebuild" | "realDisplay" | "resources">;

/**
 * Prepare one stage against full config identities, retaining the rebound
 * baseline even when that stage withholds an artifact or produces only noops.
 *
 * @param inputs - Full declarations, stage desired state, and prior baseline.
 * @returns Rebound state plus validated operations, or a preflight refusal.
 */
export function prepareReconcile({
	declarations,
	desired,
	includeOrphans = true,
	orphans,
	prior,
}: {
	readonly declarations: ReadonlyArray<ResourceDesiredInput>;
	readonly desired: ReadonlyArray<ResourceDesiredState | RetiredInput>;
	readonly includeOrphans?: boolean;
	readonly orphans?: OrphanPolicy | undefined;
	readonly prior: Baseline;
}): Result<Baseline & { readonly ops: ReadonlyArray<Operation> }, BuildDesiredError> {
	const rebound = rebindCurrent(declarations, { ...prior, orphanPolicy: orphans });
	if (!rebound.success) {
		return rebound;
	}

	const validated = assertAllReconcilable(desired, rebound.data.resources);
	if (!validated.success) {
		return validated;
	}

	return {
		data: {
			...rebound.data,
			ops: diffRebound(desired, {
				...rebound.data,
				orphans: includeOrphans ? rebound.data.orphans : [],
			}),
		},
		success: true,
	};
}
