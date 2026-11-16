import { OpenCloudError } from "@bedrock-rbx/ocale";

/**
 * A **Paid create** the badge Driver did not send, because the **Interrupt**
 * began while it prepared the send. Nothing reached Roblox, so nothing was
 * charged.
 */
export class PaidSendNotStartedError extends OpenCloudError {
	public override readonly name: string = "PaidSendNotStartedError";

	constructor() {
		super("The paid badge create was not sent: an Interrupt began before the send");
	}
}
