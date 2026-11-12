import type { Result } from "@bedrock-rbx/ocale";

import type { Except } from "type-fest";

import { annotateReverts } from "../core/annotate-reverts.ts";
import {
	allowsDeferredCreates,
	type BadgeQuotaExceededError,
	type DeferredCreate,
} from "../core/capacity-check.ts";
import { diffRebound } from "../core/diff.ts";
import { flattenConfig, type RetiredInput } from "../core/flatten.ts";
import type { Operation } from "../core/operations.ts";
import { prepareReconcile } from "../core/prepare-reconcile.ts";
import type { ResourceDesiredState } from "../core/resources.ts";
import type { ResolvedConfig } from "../core/schema.ts";
import type { BedrockState } from "../core/state.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";
import type { ResourceKey } from "../types/ids.ts";
import type { BuildDesiredError } from "./build-desired.ts";
import type { MissingCredentialError } from "./build-state-port.ts";
import { checkCapacityAsync, type FreeBadgeQuota } from "./check-capacity.ts";
import {
	type LiveCheck,
	type LiveCheckError,
	type LiveCheckOptions,
	type OutOfBandEditsError,
	readLiveStateAsync,
} from "./read-live-state.ts";

/** What a preview reconcile reads from the resolved preview dependencies. */
interface PreviewReconcileInputs extends LiveCheckOptions {
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
	readonly registry: Partial<DriverRegistry> | undefined;
}

/** What a preview reports from its reconcile. */
interface PreviewedReconcile {
	/** Badge creates a Deploy would defer, in Key order. */
	readonly deferredCreates: ReadonlyArray<DeferredCreate>;
	readonly drift: ReadonlyArray<Operation>;
	readonly liveCheck: LiveCheck;
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
export async function reconcilePreviewAsync(
	inputs: PreviewReconcileInputs,
): Promise<
	Result<
		PreviewedReconcile,
		| BadgeQuotaExceededError
		| LiveCheckError
		| MissingCredentialError
		| OutOfBandEditsError
		| { readonly cause: BuildDesiredError; readonly kind: "buildDesiredFailed" }
	>
> {
	const { config, desired, prior, registry } = inputs;
	const rebound = prepareReconcile({
		declarations: flattenConfig(config),
		desired,
		orphans: config.orphans,
		prior: prior ?? { resources: [] },
	});
	if (!rebound.success) {
		return { err: { cause: rebound.err, kind: "buildDesiredFailed" }, success: false };
	}

	const { resources } = rebound.data;
	const live = await readLiveStateAsync(registry, { ...inputs, resources });
	if (!live.success) {
		return live;
	}

	return withCapacityAsync(inputs, {
		drift: rebound.data.ops,
		liveCheck: live.data.check,
		ops: annotateReverts(
			[
				...diffRebound(desired, { orphans: [], resources: live.data.resources }),
				...rebound.data.ops.slice(desired.length),
			],
			live.data.check.edits,
		),
		pendingRebuild: [...(rebound.data.pendingRebuild ?? [])],
	});
}

async function withCapacityAsync(
	inputs: PreviewReconcileInputs,
	preview: Except<PreviewedReconcile, "deferredCreates">,
): Promise<Result<PreviewedReconcile, BadgeQuotaExceededError>> {
	const capacity = await checkCapacityAsync({
		allowDeferredCreates: allowsDeferredCreates(inputs.config.environments, inputs.environment),
		ops: preview.ops,
		quota: inputs.badgeQuota,
	});
	if (!capacity.success) {
		return capacity;
	}

	return {
		data: {
			...preview,
			deferredCreates: capacity.data.mode === "parallel" ? capacity.data.deferred : [],
		},
		success: true,
	};
}
