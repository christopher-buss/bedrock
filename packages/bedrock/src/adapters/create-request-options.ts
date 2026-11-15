import type { RequestOptions } from "@bedrock-rbx/ocale";

import type { ResourceApplyContext } from "../ports/resource-driver.ts";

/**
 * Time limit of one create request. The SDK sets no default limit on a
 * multipart body, so a stalled create could otherwise wait until CI stops
 * the job. A create that runs out of time is an ambiguous result and goes to
 * create recovery.
 */
const CREATE_TIMEOUT_MS = 120_000;

/**
 * Build the request options for one create call.
 *
 * @param context - The apply context of the create, if any.
 * @returns The create time limit, and the Interrupt signal when present.
 */
export function createRequestOptions(context: ResourceApplyContext | undefined): RequestOptions {
	return {
		timeout: CREATE_TIMEOUT_MS,
		...(context?.signal === undefined ? {} : { signal: context.signal }),
	};
}
