import { createFakeHttpClient, validUniverseBody } from "@bedrock-rbx/ocale/testing";
import { UniversesClient } from "@bedrock-rbx/ocale/universes";

/**
 * Builds a universes client over its own fake transport that answers one
 * universe read. Badge drivers read the owner on their first create; a
 * separate transport keeps that read out of the badge request queue a test
 * asserts on.
 *
 * @param options - Universe owner kind, or `"unreadable"` for a failed read.
 * @returns A universes client for `createBadgeDriver`.
 */
export function fakeUniverses({
	owner = "user",
}: { readonly owner?: "group" | "unreadable" | "user" } = {}): UniversesClient {
	const httpClient = createFakeHttpClient();
	if (owner === "unreadable") {
		httpClient.mockApiError({
			code: "NOT_FOUND",
			message: "Universe not found",
			statusCode: 404,
		});
	} else {
		httpClient.mockResponse({
			body: validUniverseBody(
				owner === "group"
					? { group: "groups/42", user: undefined }
					: { user: "users/7777" },
			),
			status: 200,
		});
	}

	return new UniversesClient({
		credential: { apiKey: "fake", kind: "apiKey" },
		httpClient,
	});
}
