import type { OpenCloudError, Result } from "@bedrock-rbx/ocale";

import type { BadgeSpendQuote } from "../core/capacity-check.ts";

/** How a diff preview runs the **Capacity check** and what it may spend. */
export interface PreviewSpendOptions {
	/**
	 * Preview the Deploy as run with spend approval: the **Capacity check**
	 * lets the Environment's **Spend limit** pay for creates beyond the free
	 * badge quota, and the preview's `spendQuote` says what it would pay.
	 *
	 * @since unreleased
	 */
	readonly allowSpend?: boolean | undefined;
	/**
	 * Reads the live price of a **Paid create** for the **Capacity check**.
	 * Defaults to the unauthenticated Roblox read.
	 *
	 * @since unreleased
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

/** What a diff preview says about **Paid creates**. */
export interface SpendPreview {
	/**
	 * What the Deploy's **Paid creates** would cost, or, without spend
	 * approval, what `--allow-spend` would pay for the Deferred creates.
	 * Absent without a shortfall or a **Spend limit**.
	 *
	 * @since unreleased
	 */
	readonly spendQuote?: BadgeSpendQuote | undefined;
}
