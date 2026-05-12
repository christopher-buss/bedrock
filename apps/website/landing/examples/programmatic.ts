import { deploy } from "@bedrock-rbx/core";

/**
 * Triggered from a webhook handler whenever a release tag is pushed.
 * Wraps `deploy` with custom orchestration: structured logging on
 * failure, success reporting back to the caller.
 *
 * @param environment - Target environment from the webhook payload.
 * @returns Whether the deploy completed successfully.
 */
export async function deployFromWebhook(environment: string): Promise<boolean> {
	const result = await deploy({ environment });
	if (!result.success) {
		console.error("bedrock deploy failed", { environment, err: result.err });
		return false;
	}

	console.log("bedrock deploy succeeded", { environment });
	return true;
}
