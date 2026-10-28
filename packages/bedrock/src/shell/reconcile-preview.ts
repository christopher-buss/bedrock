import type { Result } from "@bedrock-rbx/ocale";

import type { BadgeQuotaExceededError } from "../core/capacity-check.ts";
import { flattenConfig, type RetiredInput } from "../core/flatten.ts";
import { prepareReconcile } from "../core/prepare-reconcile.ts";
import type { ResourceDesiredState } from "../core/resources.ts";
import type { ResolvedConfig } from "../core/schema.ts";
import type { BedrockState } from "../core/state.ts";
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
	/** The prior snapshot, absent before the first Deploy. */
	readonly prior: BedrockState | undefined;
}

type PreparedReconcile = Extract<ReturnType<typeof prepareReconcile>, { success: true }>["data"];

/**
 * Diff the desired state against the prior snapshot, then run the
 * **Capacity check** over the Operations, as a Deploy would.
 *
 * @param inputs - The config, desired state, prior snapshot, and quota read.
 * @returns The reconcile result, or the refusal.
 */
export async function reconcilePreviewAsync({
	badgeQuota,
	config,
	desired,
	prior,
}: PreviewReconcileInputs): Promise<
	Result<
		PreparedReconcile,
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
		allowDeferredCreates: false,
		ops: rebound.data.ops,
		quota: badgeQuota,
	});
	return capacity.success ? rebound : capacity;
}
