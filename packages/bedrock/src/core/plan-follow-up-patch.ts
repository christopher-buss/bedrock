import type { DeveloperProduct } from "@bedrock-rbx/ocale/developer-products";

import type { DeveloperProductDesiredState } from "./resources.ts";

/**
 * Optional follow-up PATCH body the developer-product driver issues after a
 * successful create POST when `storePageEnabled` was declared on desired
 * state. The Roblox v2 create endpoint does not accept `storePageEnabled`,
 * so the driver applies the flag in a PATCH after the POST returns.
 */
interface FollowUpPatchBody {
	/** The `storePageEnabled` value the driver should apply via PATCH. */
	readonly storePageEnabled: boolean;
}

/**
 * Plan the optional follow-up PATCH body needed after a developer-product
 * create POST. Returns `undefined` when no PATCH is required: either the
 * user did not declare `storePageEnabled`, or the create response already
 * matches the desired value.
 *
 * @param desired - Desired state for the developer product being created.
 * @param createResponse - The `storePageEnabled` value reported by the create POST response.
 * @returns The PATCH body to issue, or `undefined` when no follow-up is needed.
 */
export function planFollowUpPatch(
	desired: DeveloperProductDesiredState,
	createResponse: Pick<DeveloperProduct, "storePageEnabled">,
): FollowUpPatchBody | undefined {
	if (desired.storePageEnabled === undefined) {
		return undefined;
	}

	if (desired.storePageEnabled === createResponse.storePageEnabled) {
		return undefined;
	}

	return { storePageEnabled: desired.storePageEnabled };
}
