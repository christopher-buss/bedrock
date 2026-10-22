import { describe, it } from "vitest";

import { resolveCredential, resolveCredentialOverride } from "./credential.ts";

describe(resolveCredential, () => {
	it("should prefer the credential over the bare key", ({ expect }) => {
		expect.assertions(1);

		expect(
			resolveCredential({ apiKey: "plain", credential: { apiKey: "cred", kind: "apiKey" } }),
		).toStrictEqual({ apiKey: "cred", credential: { apiKey: "cred", kind: "apiKey" } });
	});

	it("should resolve an empty key when neither is given", ({ expect }) => {
		expect.assertions(1);

		expect(resolveCredential({})).toStrictEqual({
			apiKey: "",
			credential: { apiKey: "", kind: "apiKey" },
		});
	});
});

describe(resolveCredentialOverride, () => {
	it("should return no fields when the request names no credential", ({ expect }) => {
		expect.assertions(1);

		expect(resolveCredentialOverride({})).toStrictEqual({});
	});

	it("should resolve a per-request credential given without a bare key", ({ expect }) => {
		expect.assertions(1);

		expect(
			resolveCredentialOverride({ credential: { apiKey: "cred", kind: "apiKey" } }),
		).toStrictEqual({ apiKey: "cred", credential: { apiKey: "cred", kind: "apiKey" } });
	});

	it("should resolve a bare per-request key", ({ expect }) => {
		expect.assertions(1);

		expect(resolveCredentialOverride({ apiKey: "plain" })).toStrictEqual({
			apiKey: "plain",
			credential: { apiKey: "plain", kind: "apiKey" },
		});
	});
});
