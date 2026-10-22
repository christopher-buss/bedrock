import { describe, it } from "vitest";

import { OpenCloudError } from "./base.ts";
import { TokenRefreshError } from "./token-refresh-error.ts";

describe(TokenRefreshError, () => {
	it("should carry the OAuth error code and the HTTP status", ({ expect }) => {
		expect.assertions(5);

		const error = new TokenRefreshError("Token refresh refused", {
			code: "invalid_grant",
			statusCode: 400,
		});

		expect(error).toBeInstanceOf(OpenCloudError);
		expect(error.name).toBe("TokenRefreshError");
		expect(error.message).toBe("Token refresh refused");
		expect(error.code).toBe("invalid_grant");
		expect(error.statusCode).toBe(400);
	});
});
