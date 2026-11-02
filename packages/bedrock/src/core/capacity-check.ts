import type { OpenCloudError } from "@bedrock-rbx/ocale";

import type { ResourceKey } from "../types/ids.ts";
import type { CreateOperation, Operation } from "./operations.ts";
import type { ResolvedConfig } from "./schema.ts";

const KEY_ORDER = new Intl.Collator();

/**
 * Outcome of a **Capacity check** over a Diff's badge creates.
 *
 * - `proceed`: Apply runs every create.
 * - `refuse`: the Deploy stops before any Operation; `available` is
 *   `undefined` when the free badge quota could not be read.
 * - `defer`: Apply runs every create except `deferred`, which become
 *   **Deferred creates**.
 * - `serial`: the quota is unknown, so Apply runs the creates one at a time
 *   in Key order and defers the rest after the first one Roblox refuses for
 *   cost.
 */
export type CapacityCheck =
	| {
			readonly available: number | undefined;
			readonly kind: "refuse";
			readonly needed: number;
	  }
	| { readonly deferred: ReadonlyArray<CreateOperation>; readonly kind: "defer" }
	| { readonly kind: "proceed" }
	| { readonly kind: "serial" };

/**
 * A Deploy refused by the **Capacity check** before any Operation, Open Cloud
 * write, or State write: its badge creates need more free badges than the
 * universe has left today.
 *
 * @since 0.4.0
 */
export interface BadgeQuotaExceededError {
	/**
	 * Free badge creates the universe has left today, or `undefined` when
	 * the quota could not be read.
	 */
	readonly available: number | undefined;
	/** Why the free badge quota could not be read, absent when it was read. */
	readonly cause?: OpenCloudError | undefined;
	/** Discriminator tag. */
	readonly kind: "badgeQuotaExceeded";
	/** Badge creates the Deploy needs. */
	readonly needed: number;
	/** The next 00:00 UTC, when the free badge quota resets. */
	readonly resetsAt: Date;
}

/**
 * A badge create the free badge quota could not cover, left for a later
 * Deploy: it sent no request and wrote no State.
 *
 * @since 0.4.0
 */
export interface DeferredCreate {
	/** Resource key of the deferred badge. */
	readonly key: ResourceKey;
	/** Kind of the deferred resource. */
	readonly kind: "badge";
}

/** Inputs to {@link checkBadgeCapacity}. */
export interface CapacityCheckInputs {
	/** Whether the Environment lets a shortfall become Deferred creates. */
	readonly allowDeferredCreates: boolean;
	/** The Diff's badge creates, as {@link badgeCreatesIn} selects them. */
	readonly creates: ReadonlyArray<CreateOperation>;
	/** Free badge creates left today, or `undefined` when the read failed. */
	readonly quota: number | undefined;
}

/**
 * Whether an Environment lets a free badge quota shortfall become Deferred
 * creates.
 *
 * @param environments - The resolved Environments.
 * @param environment - The Environment being reconciled.
 * @returns `true` when the Environment sets `allowDeferredCreates: true`.
 */
export function allowsDeferredCreates(
	environments: ResolvedConfig["environments"],
	environment: string,
): boolean {
	return environments[environment]?.allowDeferredCreates === true;
}

/**
 * The Deferred create for a badge.
 *
 * @param key - Resource key of the badge.
 * @returns The Deferred create.
 */
export function deferredBadge(key: ResourceKey): DeferredCreate {
	return { key, kind: "badge" };
}

/**
 * Select the badge `create` Operations from a Diff.
 *
 * @param ops - Every Operation the Diff produced.
 * @returns The badge creates, in Diff order.
 */
export function badgeCreatesIn(ops: ReadonlyArray<Operation>): ReadonlyArray<CreateOperation> {
	return ops.filter((op): op is CreateOperation => {
		return op.type === "create" && op.desired.kind === "badge";
	});
}

/**
 * Sort entries by resource key, the order the **Capacity check** spends the
 * free badge quota in.
 *
 * @template T - The keyed entry type.
 * @param entries - The entries to sort.
 * @returns A sorted copy.
 */
export function inKeyOrder<T extends { readonly key: string }>(
	entries: ReadonlyArray<T>,
): ReadonlyArray<T> {
	return entries.toSorted((left, right) => KEY_ORDER.compare(left.key, right.key));
}

/**
 * Compare a Diff's badge creates against the universe's free badge quota.
 * Without deferral, a shortfall or an unknown quota refuses the Deploy. With
 * deferral, the creates beyond the quota, in Key order, are deferred, and an
 * unknown quota runs the creates serially.
 *
 * @param inputs - The badge creates, the deferral setting, and the quota.
 * @returns Whether the Deploy proceeds, is refused, defers some creates, or
 *   runs them serially.
 */
export function checkBadgeCapacity({
	allowDeferredCreates,
	creates,
	quota,
}: CapacityCheckInputs): CapacityCheck {
	if (quota !== undefined && creates.length <= quota) {
		return { kind: "proceed" };
	}

	if (!allowDeferredCreates) {
		return { available: quota, kind: "refuse", needed: creates.length };
	}

	if (quota === undefined) {
		return { kind: "serial" };
	}

	return { deferred: inKeyOrder(creates).slice(quota), kind: "defer" };
}

/**
 * The next 00:00 UTC after `now`, when the free badge quota resets.
 *
 * @param now - The current time.
 * @returns The start of the next UTC day.
 */
export function nextFreeBadgeQuotaReset(now: Date): Date {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}
