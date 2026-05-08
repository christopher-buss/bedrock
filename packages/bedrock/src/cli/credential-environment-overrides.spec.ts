import { describe, expect, it } from "vitest";

import { buildCredentialOverrides } from "./credential-environment-overrides.ts";

describe(buildCredentialOverrides, () => {
	it("should map apiKey to BEDROCK_API_KEY when supplied", () => {
		expect.assertions(1);

		const result = buildCredentialOverrides({ apiKey: "rbx-123" });

		expect(result).toStrictEqual({ BEDROCK_API_KEY: "rbx-123" });
	});

	it("should map githubToken to GITHUB_TOKEN when supplied", () => {
		expect.assertions(1);

		const result = buildCredentialOverrides({ githubToken: "ghp_456" });

		expect(result).toStrictEqual({ GITHUB_TOKEN: "ghp_456" });
	});

	it("should include both env vars when both flags are supplied", () => {
		expect.assertions(1);

		const result = buildCredentialOverrides({ apiKey: "rbx-123", githubToken: "ghp_456" });

		expect(result).toStrictEqual({ BEDROCK_API_KEY: "rbx-123", GITHUB_TOKEN: "ghp_456" });
	});

	it("should return an empty record when neither flag is supplied", () => {
		expect.assertions(1);

		const result = buildCredentialOverrides({});

		expect(result).toStrictEqual({});
	});
});
