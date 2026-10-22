import { describe, it } from "vitest";

import { OpenCloudError } from "./base.ts";
import { CredentialRejectedError } from "./credential-rejected.ts";

describe(CredentialRejectedError, () => {
	it("should carry the identity, status, code and cause", ({ expect }) => {
		expect.assertions(2);

		const cause = new Error("upstream");
		const error = new CredentialRejectedError("HTTP 401: Invalid Token.", {
			cause,
			code: "UNAUTHENTICATED",
			identity: "user-1",
			statusCode: 401,
		});

		expect(error).toBeInstanceOf(OpenCloudError);
		expect(error).toMatchObject({
			name: "CredentialRejectedError",
			cause,
			code: "UNAUTHENTICATED",
			identity: "user-1",
			message: "HTTP 401: Invalid Token.",
			statusCode: 401,
		});
	});
});
