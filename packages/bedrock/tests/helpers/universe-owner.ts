import { createFakeHttpClient, validUniverseBody } from "@bedrock-rbx/ocale/testing";
import { UniversesClient } from "@bedrock-rbx/ocale/universes";

/**
 * Builds a universes client over its own fake transport that answers one
 * universe read with a user-owned universe. Badge drivers read the owner on
 * their first create; a separate transport keeps that read out of the badge
 * request queue a test asserts on.
 *
 * @returns A universes client for `createBadgeDriver`.
 */
export function userOwnedUniverses(): UniversesClient {
	return new UniversesClient({
		credential: { apiKey: "fake", kind: "apiKey" },
		httpClient: createFakeHttpClient().mockResponse({
			body: validUniverseBody({ user: "users/7777" }),
			status: 200,
		}),
	});
}
