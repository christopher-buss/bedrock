import type { OpenCloudError } from "@bedrock-rbx/ocale";

import type { Except } from "type-fest";

import type { ResourceKey } from "../types/ids.ts";
import type { CreateOperation, Operation } from "./operations.ts";
import type { EnvironmentEntry, ResolvedConfig } from "./schema.ts";

const KEY_ORDER = new Intl.Collator();

/**
 * The Robux that **Paid creates** for a refused Deploy would cost, more than
 * the Environment's **Spend limit** allows.
 *
 * @since unreleased
 */
export interface BadgeSpendShortfall {
	/** The Spend limit in effect for the Deploy, in Robux. */
	readonly limit: number;
	/** Robux the badge creates beyond the free badge quota would cost. */
	readonly needed: number;
	/** The live price of one Paid create, in Robux. */
	readonly price: number;
}

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
 * - `pay`: Apply runs every create, and the Spend limit covers the `paid`
 *   creates beyond the quota at `price` Robux each.
 */
export type CapacityCheck =
	| {
			readonly available: number | undefined;
			readonly kind: "refuse";
			readonly needed: number;
			readonly spend?: BadgeSpendShortfall;
	  }
	| { readonly deferred: ReadonlyArray<CreateOperation>; readonly kind: "defer" }
	| { readonly kind: "pay"; readonly paid: number; readonly price: number }
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
	/**
	 * Why the free badge quota, or the price of a **Paid create**, could not
	 * be read; absent when every read that ran succeeded.
	 */
	readonly cause?: OpenCloudError | undefined;
	/** Discriminator tag. */
	readonly kind: "badgeQuotaExceeded";
	/** Badge creates the Deploy needs. */
	readonly needed: number;
	/** The next 00:00 UTC, when the free badge quota resets. */
	readonly resetsAt: Date;
	/**
	 * The Robux the creates beyond the free badge quota need, over the
	 * **Spend limit**. Absent when the Deploy had no Spend limit in effect or
	 * the price could not be read.
	 *
	 * @since unreleased
	 */
	readonly spend?: BadgeSpendShortfall | undefined;
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
	/**
	 * The live price of one **Paid create**, or `undefined` when it was not
	 * read.
	 */
	readonly price?: number | undefined;
	/** Free badge creates left today, or `undefined` when the read failed. */
	readonly quota: number | undefined;
	/** Robux the Deploy may spend on Paid creates; `0` spends nothing. */
	readonly spendLimit?: number;
}

/**
 * How many Robux a Deploy may spend on **Paid creates**.
 *
 * @param entry - The Environment being reconciled, if declared.
 * @param allowSpend - Whether the run gives spend approval.
 * @returns The Environment's `spendLimit` with approval, otherwise `0`.
 */
export function spendLimitOf(
	entry: Pick<EnvironmentEntry, "spendLimit"> | undefined,
	allowSpend: boolean,
): number {
	return allowSpend ? (entry?.spendLimit ?? 0) : 0;
}

/**
 * Whether {@link checkBadgeCapacity} needs the live price of a **Paid
 * create**: the quota is known and falls short, deferral is off, and the
 * Deploy may spend.
 *
 * @param inputs - The badge creates, the deferral setting, the quota, and the
 *   Spend limit in effect.
 * @returns `true` when the price must be read before the check.
 */
export function needsCreationPrice({
	allowDeferredCreates,
	creates,
	quota,
	spendLimit = 0,
}: Except<CapacityCheckInputs, "price">): boolean {
	return !allowDeferredCreates && quota !== undefined && creates.length > quota && spendLimit > 0;
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
 * Without deferral, a shortfall the Spend limit covers at a live price above
 * 0 becomes **Paid creates**; any other shortfall, or an unknown quota, refuses
 * the Deploy. With deferral, the creates beyond the quota, in Key order, are
 * deferred, and an unknown quota runs the creates serially.
 *
 * @param inputs - The badge creates, the deferral setting, the quota, the
 *   Spend limit in effect, and the live price.
 * @returns Whether the Deploy proceeds, pays, is refused, defers some
 *   creates, or runs them serially.
 */
export function checkBadgeCapacity({
	allowDeferredCreates,
	creates,
	price,
	quota,
	spendLimit = 0,
}: CapacityCheckInputs): CapacityCheck {
	if (quota !== undefined && creates.length <= quota) {
		return { kind: "proceed" };
	}

	if (!allowDeferredCreates) {
		const refusal = { available: quota, kind: "refuse", needed: creates.length } as const;
		if (quota === undefined || price === undefined || spendLimit === 0 || price <= 0) {
			return refusal;
		}

		const paid = creates.length - quota;
		const robux = paid * price;
		return robux <= spendLimit
			? { kind: "pay", paid, price }
			: { ...refusal, spend: { limit: spendLimit, needed: robux, price } };
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
