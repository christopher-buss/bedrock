import type { DeployedState } from "../shell/deploy.ts";
import { spendQuoteCost } from "./spend-quote.ts";

/**
 * Render what the **Paid creates** of a successful Deploy cost.
 *
 * @param run - The Environment, its **Spend limit**, and what the Deploy
 *   paid for.
 * @returns One line naming the count of Paid creates, the price, the total,
 *   and the Spend limit, or `undefined` when the Deploy paid for none.
 */
export function paidCreatesLine({
	environment,
	limit,
	state,
}: {
	readonly environment: string;
	readonly limit: number;
	readonly state: Pick<DeployedState, "paidCreates" | "robuxSpent">;
}): string | undefined {
	const paid = state.paidCreates?.length ?? 0;
	if (paid === 0) {
		return undefined;
	}

	const robux = state.robuxSpent ?? 0;
	const cost = spendQuoteCost({ limit, paid, price: robux / paid });
	return `${paid} paid badge creates in "${environment}": ${cost}`;
}
