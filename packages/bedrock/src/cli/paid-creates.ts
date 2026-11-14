import type { Config } from "../core/schema.ts";
import type { DeployedState } from "../shell/deploy.ts";
import { spendQuoteCost } from "./spend-quote.ts";

/**
 * Report what the **Paid creates** of a successful Deploy cost: the count,
 * the price, the total, and the Environment's **Spend limit**. Silent when
 * the Deploy paid for none.
 *
 * @param port - Where the line is written.
 * @param run - The config, the Environment, and what the Deploy paid for.
 */
export function reportPaidCreates(
	port: { readonly logMessage: (message: string) => void },
	{
		config,
		environment,
		state,
	}: {
		readonly config: Config;
		readonly environment: string;
		readonly state: Pick<DeployedState, "paidCreates" | "robuxSpent">;
	},
): void {
	const paid = state.paidCreates?.length ?? 0;
	if (paid === 0) {
		return;
	}

	const robux = state.robuxSpent ?? 0;
	const limit = config.environments[environment]?.spendLimit ?? 0;
	const cost = spendQuoteCost({ limit, paid, price: robux / paid });
	port.logMessage(`${paid} paid badge creates in "${environment}": ${cost}`);
}
