import { describe, expect, it, onTestFinished, vi } from "vitest";

import { buildCredentialEnvironment } from "./build-credential-environment.ts";

describe(buildCredentialEnvironment, () => {
	it("should map the apiKey flag value to BEDROCK_API_KEY", () => {
		expect.assertions(1);

		const getEnvironment = buildCredentialEnvironment({ apiKey: "abc" }, empty);

		expect(getEnvironment("BEDROCK_API_KEY")).toBe("abc");
	});

	it("should map the githubToken flag value to GITHUB_TOKEN", () => {
		expect.assertions(1);

		const getEnvironment = buildCredentialEnvironment({ githubToken: "xyz" }, empty);

		expect(getEnvironment("GITHUB_TOKEN")).toBe("xyz");
	});

	it("should consult the fallback for variables outside the credential mapping", () => {
		expect.assertions(1);

		const getEnvironment = buildCredentialEnvironment(
			{},
			bindEnvironment({ OTHER_VAR: "FOO" }),
		);

		expect(getEnvironment("OTHER_VAR")).toBe("FOO");
	});

	it("should consult the fallback when the credential flag is undefined", () => {
		expect.assertions(1);

		const getEnvironment = buildCredentialEnvironment(
			{},
			bindEnvironment({ BEDROCK_API_KEY: "from-env" }),
		);

		expect(getEnvironment("BEDROCK_API_KEY")).toBe("from-env");
	});

	it("should overlay only the named credential slot, not the other", () => {
		expect.assertions(2);

		const getEnvironment = buildCredentialEnvironment(
			{ apiKey: "FLAG" },
			bindEnvironment({ GITHUB_TOKEN: "from-env" }),
		);

		expect(getEnvironment("BEDROCK_API_KEY")).toBe("FLAG");
		expect(getEnvironment("GITHUB_TOKEN")).toBe("from-env");
	});

	it("should not apply the githubToken value to near-miss variable names", () => {
		expect.assertions(1);

		const getEnvironment = buildCredentialEnvironment({ githubToken: "FLAG" }, empty);

		expect(getEnvironment("GITHUB_TOKEN_X")).toBeUndefined();
	});

	it("should default to a process.env reader when fallback is omitted", () => {
		expect.assertions(1);

		onTestFinished(() => {
			vi.unstubAllEnvs();
		});
		vi.stubEnv("BEDROCK_API_KEY", "from-process");

		const getEnvironment = buildCredentialEnvironment({});

		expect(getEnvironment("BEDROCK_API_KEY")).toBe("from-process");
	});
});

function bindEnvironment(
	bindings: Readonly<Record<string, string>>,
): (name: string) => string | undefined {
	return (name) => bindings[name];
}

function empty(): string | undefined {
	return undefined;
}
