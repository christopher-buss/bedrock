import type { Result } from "@bedrock-rbx/ocale";

import type { Except } from "type-fest";

import { annotateReverts } from "../core/annotate-reverts.ts";
import {
	allowsDeferredCreates,
	type BadgeQuotaExceededError,
	type BadgeSpendQuote,
	type DeferredCreate,
	spendLimitOf,
} from "../core/capacity-check.ts";
import { diffRebound } from "../core/diff.ts";
import { environmentPrefix } from "../core/environment-prefix.ts";
import { flattenConfig, type RetiredInput } from "../core/flatten.ts";
import { guardCreatesByName } from "../core/name-guard.ts";
import type { Operation } from "../core/operations.ts";
import { prepareReconcile } from "../core/prepare-reconcile.ts";
import type { ResourceCurrentState, ResourceDesiredState } from "../core/resources.ts";
import type { ResolvedConfig } from "../core/schema.ts";
import type { BedrockState, UnconfirmedPaidCreate } from "../core/state.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";
import type { ResourceKey } from "../types/ids.ts";
import type { BuildDesiredError } from "./build-desired.ts";
import type { MissingCredentialError } from "./build-state-port.ts";
import { checkCapacityAsync, type FreeBadgeQuota } from "./check-capacity.ts";
import { type ImportedResource, importLiveAsync } from "./import-live.ts";
import {
	type LiveCheck,
	type LiveCheckError,
	type LiveCheckOptions,
	type OutOfBandEditsError,
	readLiveStateAsync,
} from "./read-live-state.ts";
import { blockingUnconfirmed } from "./unconfirmed-paid-creates.ts";

/** What a preview reconcile reads from the resolved preview dependencies. */
interface PreviewReconcileInputs extends LiveCheckOptions {
	/** Whether the preview runs as a Deploy with spend approval. */
	readonly allowSpend?: boolean | undefined;
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
	/** Reads local icon files an import records. */
	readonly readFile: (path: string) => Promise<Uint8Array>;
	readonly registry: Partial<DriverRegistry> | undefined;
}

type PreviewReconcileError =
	| BadgeQuotaExceededError
	| LiveCheckError
	| MissingCredentialError
	| OutOfBandEditsError
	| { readonly cause: BuildDesiredError; readonly kind: "buildDesiredFailed" };

/** What a preview reports from its reconcile. */
interface PreviewedReconcile {
	/** Badge creates a Deploy would defer, in Key order. */
	readonly deferredCreates: ReadonlyArray<DeferredCreate>;
	readonly drift: ReadonlyArray<Operation>;
	/** Live items `importId` recorded as Current state before the Diff. */
	readonly imports: ReadonlyArray<ImportedResource>;
	readonly liveCheck: LiveCheck;
	/** Operations a Deploy would apply, deferred creates included. */
	readonly ops: ReadonlyArray<Operation>;
	/** Place keys still owing a publish. */
	readonly pendingRebuild: ReadonlyArray<ResourceKey>;
	/** What Paid creates cost, or would cost with spend approval. */
	readonly spendQuote?: BadgeSpendQuote | undefined;
	/** The **Unconfirmed paid creates** that stop a create, in State order. */
	readonly unconfirmedPaidCreates?: ReadonlyArray<UnconfirmedPaidCreate>;
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
): Promise<Result<PreviewedReconcile, PreviewReconcileError>> {
	const imported = await importLiveAsync(inputs, inputs.prior);
	if (!imported.success) {
		return imported;
	}

	const reconciled = await reconcileAsync({ ...inputs, prior: imported.data.state });
	if (!reconciled.success) {
		return reconciled;
	}

	const { imported: imports, state } = imported.data;
	return {
		data: {
			...reconciled.data,
			imports,
			unconfirmedPaidCreates: blockingUnconfirmed(inputs.config, state),
		},
		success: true,
	};
}

async function withCapacityAsync(
	inputs: PreviewReconcileInputs,
	preview: Except<
		PreviewedReconcile,
		"deferredCreates" | "imports" | "spendQuote" | "unconfirmedPaidCreates"
	>,
): Promise<
	Result<
		Except<PreviewedReconcile, "imports" | "unconfirmedPaidCreates">,
		BadgeQuotaExceededError
	>
> {
	const entry = inputs.config.environments[inputs.environment];
	const capacity = await checkCapacityAsync({
		allowDeferredCreates: allowsDeferredCreates(inputs.config.environments, inputs.environment),
		configuredSpendLimit: spendLimitOf(entry, true),
		ops: preview.ops,
		quota: inputs.badgeQuota,
		spendLimit: spendLimitOf(entry, inputs.allowSpend === true),
	});
	if (!capacity.success) {
		return capacity;
	}

	const plan = capacity.data;
	if (plan.mode === "serial") {
		return {
			data: { ...preview, deferredCreates: [], spendQuote: plan.spendQuote },
			success: true,
		};
	}

	return {
		data: { ...preview, deferredCreates: plan.deferred, spendQuote: plan.spendQuote },
		success: true,
	};
}

/**
 * Diff the desired state against the live-refreshed Current state, keeping
 * the retirements the saved State planned.
 *
 * @param desired - The desired state built from config.
 * @param planned - The live check's result and the Operations planned
 *   against saved State.
 * @returns The Operations a Deploy would apply.
 */
function liveOps(
	desired: ReadonlyArray<ResourceDesiredState | RetiredInput>,
	{
		live,
		rebound,
	}: {
		readonly live: {
			readonly check: LiveCheck;
			readonly resources: ReadonlyArray<ResourceCurrentState>;
		};
		readonly rebound: ReadonlyArray<Operation>;
	},
): ReadonlyArray<Operation> {
	return annotateReverts(
		[
			...diffRebound(desired, { orphans: [], resources: live.resources }),
			...rebound.slice(desired.length),
		],
		{ desired, edits: live.check.edits, resources: live.resources },
	);
}

function guardNames(
	{ config, environment }: Pick<PreviewReconcileInputs, "config" | "environment">,
	planned: Pick<Parameters<typeof guardCreatesByName>[0], "ops" | "resources" | "snapshot">,
): ReturnType<typeof guardCreatesByName> {
	return guardCreatesByName({
		...planned,
		environment,
		prefix: environmentPrefix(config, environment),
	});
}

async function reconcileAsync(
	inputs: PreviewReconcileInputs & { readonly prior: BedrockState },
): Promise<Result<Except<PreviewedReconcile, "imports">, PreviewReconcileError>> {
	const { config, desired, prior, registry } = inputs;
	const rebound = prepareReconcile({
		declarations: flattenConfig(config),
		desired,
		orphans: config.orphans,
		prior,
	});
	if (!rebound.success) {
		return { err: { cause: rebound.err, kind: "buildDesiredFailed" }, success: false };
	}

	const { resources } = rebound.data;
	const live = await readLiveStateAsync(registry, { ...inputs, resources });
	if (!live.success) {
		return live;
	}

	const ops = liveOps(desired, { live: live.data, rebound: rebound.data.ops });
	const guarded = guardNames(inputs, { ...live.data, ops });
	return guarded.success
		? withCapacityAsync(inputs, {
				drift: rebound.data.ops,
				liveCheck: live.data.check,
				ops,
				pendingRebuild: [...(rebound.data.pendingRebuild ?? [])],
			})
		: { err: { cause: guarded.err, kind: "buildDesiredFailed" }, success: false };
}
