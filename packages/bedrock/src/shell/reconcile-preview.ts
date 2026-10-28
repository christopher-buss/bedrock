import type { Result } from "@bedrock-rbx/ocale";

import {
	allowsDeferredCreates,
	type BadgeQuotaExceededError,
	type DeferredCreate,
} from "../core/capacity-check.ts";
import { flattenConfig, type RetiredInput } from "../core/flatten.ts";
import type { Operation } from "../core/operations.ts";
import { prepareReconcile } from "../core/prepare-reconcile.ts";
import type { ResourceDesiredState } from "../core/resources.ts";
import type { ResolvedConfig } from "../core/schema.ts";
import type { BedrockState } from "../core/state.ts";
import type { ResourceKey } from "../types/ids.ts";
import type { BuildDesiredError } from "./build-desired.ts";
import { checkCapacityAsync, type FreeBadgeQuota } from "./check-capacity.ts";

/** What a preview reconcile reads from the resolved preview dependencies. */
interface PreviewReconcileInputs {
	/** Reads the free badge quota for the **Capacity check**. */
	readonly badgeQuota: FreeBadgeQuota;
	/** The effective config of the previewed Environment. */
	readonly config: ResolvedConfig;
	/** The desired state built from `config`. */
	readonly desired: ReadonlyArray<ResourceDesiredState | RetiredInput>;
	/** The previewed Environment, whose overlay sets the deferral setting. */
	readonly environment: string;
	/** The prior snapshot, absent before the first Deploy. */
	readonly prior: BedrockState | undefined;
}

/** What a preview reports from its reconcile. */
interface PreviewedReconcile {
	/** Badge creates a Deploy would defer, in Key order. */
	readonly deferredCreates: ReadonlyArray<DeferredCreate>;
	/** Operations a Deploy would apply, deferred creates included. */
	readonly ops: ReadonlyArray<Operation>;
	/** Place keys still owing a publish. */
	readonly pendingRebuild: ReadonlyArray<ResourceKey>;
}

/**
 * Diff the desired state against the prior snapshot, then run the
 * **Capacity check** over the Operations, as a Deploy would.
 *
 * @param inputs - The config, Environment, desired state, prior snapshot,
 *   and quota read.
 * @returns The reconcile result with the Deferred creates, or the refusal.
 */
export async function reconcilePreviewAsync({
	badgeQuota,
	config,
	desired,
	environment,
	prior,
}: PreviewReconcileInputs): Promise<
	Result<
		PreviewedReconcile,
		| BadgeQuotaExceededError
		| { readonly cause: BuildDesiredError; readonly kind: "buildDesiredFailed" }
	>
> {
	const rebound = prepareReconcile({
		declarations: flattenConfig(config),
		desired,
		orphans: config.orphans,
		prior: prior ?? { resources: [] },
	});
	if (!rebound.success) {
		return { err: { cause: rebound.err, kind: "buildDesiredFailed" }, success: false };
	}

	const capacity = await checkCapacityAsync({
		allowDeferredCreates: allowsDeferredCreates(config.environments, environment),
		ops: rebound.data.ops,
		quota: badgeQuota,
	});
	if (!capacity.success) {
		return capacity;
	}

	return {
		data: {
			deferredCreates: capacity.data.mode === "parallel" ? capacity.data.deferred : [],
			ops: rebound.data.ops,
			pendingRebuild: [...(rebound.data.pendingRebuild ?? [])],
		},
		success: true,
	};
}
