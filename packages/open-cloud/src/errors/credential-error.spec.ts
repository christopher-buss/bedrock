import { describe, it } from "vitest";

import { OpenCloudError } from "./base.ts";
import { CredentialError } from "./credential-error.ts";

describe(CredentialError, () => {
	it("should carry the provider failure as a typed Open Cloud error", ({ expect }) => {
		expect.assertions(4);

		const cause = new Error("provider down");
		const error = new CredentialError("Credential provider failed", { cause });

		expect(error).toBeInstanceOf(OpenCloudError);
		expect(error.name).toBe("CredentialError");
		expect(error.message).toBe("Credential provider failed");
		expect(error.cause).toBe(cause);
	});
});
