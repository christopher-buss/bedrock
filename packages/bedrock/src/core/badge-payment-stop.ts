import { BadgeCostMismatchError, type OpenCloudError } from "@bedrock-rbx/ocale";

/**
 * A badge create Roblox refused for cost that bedrock did not pay for,
 * because an earlier **Paid create** in the same Deploy failed for a payment
 * reason. It is a {@link BadgeCostMismatchError}, so an Environment that
 * allows Deferred creates defers it; otherwise it is a failed create whose
 * message names the payment error that stopped spending.
 *
 * @since unreleased
 *
 * @example
 *
 * ```ts
 * import { BadgeCostMismatchError, BadgeInsufficientFundsError } from "@bedrock-rbx/ocale";
 * import { BadgePaymentStoppedError } from "@bedrock-rbx/core";
 *
 * const refusal = new BadgeCostMismatchError("HTTP 403", { expectedCost: 0, statusCode: 403 });
 * const stoppedBy = new BadgeInsufficientFundsError("HTTP 403: Insufficient funds.", {
 *     statusCode: 403,
 * });
 * const err = new BadgePaymentStoppedError(refusal, stoppedBy);
 *
 * expect(err).toBeInstanceOf(BadgeCostMismatchError);
 * expect(err.name).toBe("BadgePaymentStoppedError");
 * expect(err.stoppedBy).toBe(stoppedBy);
 * expect(err.message).toContain("insufficient funds");
 * ```
 */
export class BadgePaymentStoppedError extends BadgeCostMismatchError {
	public override readonly name: string = "BadgePaymentStoppedError";
	/** The payment error on the earlier Paid create that stopped spending. */
	public readonly stoppedBy: OpenCloudError;

	/**
	 * Wraps the cost refusal of a create that was not paid for.
	 *
	 * @param refusal - Roblox's cost refusal of the free create.
	 * @param stoppedBy - The payment error that stopped spending.
	 */
	constructor(refusal: BadgeCostMismatchError, stoppedBy: OpenCloudError) {
		super(
			`Roblox refused the free create and bedrock sent no paid create, because an earlier paid create in this deploy failed: ${stopReason(stoppedBy)}`,
			{
				cause: refusal,
				code: refusal.code,
				expectedCost: refusal.expectedCost,
				statusCode: refusal.statusCode,
			},
		);
		this.stoppedBy = stoppedBy;
	}
}

function stopReason(_stoppedBy: OpenCloudError): string {
	return "insufficient funds. Add Robux to the account that pays, then deploy again";
}
