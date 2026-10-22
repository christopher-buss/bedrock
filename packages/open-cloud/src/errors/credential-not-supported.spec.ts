import { describe, it } from "vitest";

import { OpenCloudError } from "./base.ts";
import { CredentialNotSupportedError } from "./credential-not-supported.ts";

describe(CredentialNotSupportedError, () => {
	it("should carry the operation key, name, message and code", ({ expect }) => {
		expect.assertions(5);

		const error = new CredentialNotSupportedError("needs an API key", {
			code: "X",
			operationKey: "places.publishVersion",
		});

		expect(error).toBeInstanceOf(OpenCloudError);
		expect(error.name).toBe("CredentialNotSupportedError");
		expect(error.message).toBe("needs an API key");
		expect(error.operationKey).toBe("places.publishVersion");
		expect(error.code).toBe("X");
	});
});
