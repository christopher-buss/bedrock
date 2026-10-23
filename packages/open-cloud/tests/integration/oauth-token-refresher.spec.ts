import { fromAny } from "@total-typescript/shoehorn";

import { assert, describe, it } from "vitest";

import { createOAuthTokenRefresher } from "#src/client/oauth-token-refresher";
import { CredentialError } from "#src/errors/credential-error";
import { TokenRefreshError } from "#src/errors/token-refresh-error";
import { GamePassesClient } from "#src/resources/game-passes/index";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";

describe("oAuth token refresher as a credential provider", () => {
	it("should surface a refused refresh as CredentialError with TokenRefreshError as cause", async ({
		expect,
	}) => {
		expect.assertions(4);

		const httpClient = createFakeHttpClient();
		const client = new GamePassesClient({
			credential: {
				getAccessToken: createOAuthTokenRefresher({
					clientId: "client-id",
					fetch: fromAny(async () => {
						return Response.json({ error: "invalid_grant" }, { status: 400 });
					}),
					onRotate: () => {},
					refreshToken: "refresh-0",
				}),
				identity: "user-1",
				kind: "oauth",
			},
			httpClient,
			sleep: createFakeSleep(),
		});

		const result = await client.get({ gamePassId: "12345", universeId: "1" });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(CredentialError);
		expect(result.err.cause).toBeInstanceOf(TokenRefreshError);
		expect(result.err.cause).toMatchObject({ code: "invalid_grant", statusCode: 400 });
		expect(httpClient.requests).toHaveLength(0);
	});
});
