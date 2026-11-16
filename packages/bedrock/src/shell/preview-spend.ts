import type { OpenCloudError, Result } from "@bedrock-rbx/ocale";

import type { BadgeSpendQuote } from "../core/capacity-check.ts";
import type { UnconfirmedPaidCreate } from "../core/state.ts";

/** How a diff preview runs the **Capacity check** and what it may spend. */
export interface PreviewSpendOptions {
	/**
	 * Preview the Deploy as run with spend approval: the **Capacity check**
	 * lets the Environment's **Spend limit** pay for creates beyond the free
	 * badge quota, and the preview's `spendQuote` says what it would pay.
	 *
	 * @since 0.5.0
	 */
	readonly allowSpend?: boolean | undefined;
	/**
	 * Reads the live price of a **Paid create** for the **Capacity check**.
	 * Defaults to the unauthenticated Roblox read.
	 *
	 * @since 0.5.0
	 */
	readonly readBadgeCreationPrice?: () => Promise<Result<number, OpenCloudError>>;
	/**
	 * Reads the universe's free badge quota for the **Capacity check**.
	 * Defaults to the unauthenticated Roblox read for `universe.universeId`;
	 * with no `universeId` declared the quota is unknown, so a preview that
	 * creates badges is refused.
	 */
	readonly readFreeBadgeQuota?: () => Promise<Result<number, OpenCloudError>>;
}

/** What a diff preview says about **Paid creates**, and unconfirmed ones. */
export interface SpendPreview {
	/**
	 * What the Deploy's **Paid creates** would cost, or, without spend
	 * approval, what `--allow-spend` would pay for the Deferred creates.
	 * Absent without a shortfall or a **Spend limit**.
	 *
	 * @since 0.5.0
	 */
	readonly spendQuote?: BadgeSpendQuote | undefined;
	/**
	 * The **Unconfirmed paid creates** whose Key a Deploy would not create:
	 * it adopts a live badge with the name, or skips or refuses the create.
	 *
	 * @since 0.5.0
	 */
	readonly unconfirmedPaidCreates?: ReadonlyArray<UnconfirmedPaidCreate>;
}
