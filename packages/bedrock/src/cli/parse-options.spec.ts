import { assert, describe, expect, it, onTestFinished, vi } from "vitest";

import { parseCommonOptions } from "./parse-options.ts";

describe(parseCommonOptions, () => {
	it("should reject when --env is missing", () => {
		expect.assertions(2);

		const result = parseCommonOptions({ "--": [], "_": [] }, empty);

		assert(!result.success);

		expect(result.err.kind).toBe("missingRequired");
		expect(result.err.flag).toBe("env");
	});

	it("should report missingRequired when --env is absent and BEDROCK_ENVIRONMENT is unset", () => {
		expect.assertions(2);

		const result = parseCommonOptions({}, empty);

		assert(!result.success);

		expect(result.err.kind).toBe("missingRequired");
		expect(result.err.flag).toBe("env");
	});

	it("should reject unknown flags by name", () => {
		expect.assertions(2);

		const result = parseCommonOptions({ env: "production", verbose: true });

		assert(!result.success);

		expect(result.err.kind).toBe("unknownFlag");
		expect(result.err.flag).toBe("verbose");
	});

	it("should reject when --env carries a non-string value", () => {
		expect.assertions(2);

		const result = parseCommonOptions({ env: false });

		assert(!result.success);

		expect(result.err.kind).toBe("invalidValue");
		expect(result.err.flag).toBe("env");
	});

	it("should reject when one of multiple --env values is not a string", () => {
		expect.assertions(2);

		const result = parseCommonOptions({ env: ["staging", true] });

		assert(!result.success);

		expect(result.err.kind).toBe("invalidValue");
		expect(result.err.flag).toBe("env");
	});

	it("should normalize a single --env into a one-element environments array", () => {
		expect.assertions(1);

		const result = parseCommonOptions({ env: "production" });

		assert(result.success);

		expect(result.data.environments).toStrictEqual(["production"]);
	});

	it("should preserve multiple --env values as a multi-element environments array", () => {
		expect.assertions(1);

		const result = parseCommonOptions({ env: ["staging", "production"] });

		assert(result.success);

		expect(result.data.environments).toStrictEqual(["staging", "production"]);
	});

	it("should default optional flags to undefined when omitted", () => {
		expect.assertions(3);

		const result = parseCommonOptions({ env: "production" });

		assert(result.success);

		expect(result.data.apiKey).toBeUndefined();
		expect(result.data.configFile).toBeUndefined();
		expect(result.data.githubToken).toBeUndefined();
	});

	it("should round-trip every recognized flag value when all are supplied", () => {
		expect.assertions(4);

		const result = parseCommonOptions({
			"--": [],
			"_": [],
			"apiKey": "key-123",
			"config": "./bedrock.staging.config.ts",
			"env": "staging",
			"githubToken": "ghp-456",
		});

		assert(result.success);

		expect(result.data.environments).toStrictEqual(["staging"]);
		expect(result.data.apiKey).toBe("key-123");
		expect(result.data.configFile).toBe("./bedrock.staging.config.ts");
		expect(result.data.githubToken).toBe("ghp-456");
	});

	it("should accept the kebab-case alternates produced by mri alongside their camelCase peers", () => {
		expect.assertions(2);

		const result = parseCommonOptions({
			"api-key": "key-123",
			"apiKey": "key-123",
			"env": "production",
			"github-token": "ghp-456",
			"githubToken": "ghp-456",
		});

		assert(result.success);

		expect(result.data.apiKey).toBe("key-123");
		expect(result.data.githubToken).toBe("ghp-456");
	});

	it("should fall back to the api-key alternate when only the kebab form is supplied", () => {
		expect.assertions(1);

		const result = parseCommonOptions({ "api-key": "kebab-key", "env": "production" });

		assert(result.success);

		expect(result.data.apiKey).toBe("kebab-key");
	});

	it("should fall back to the github-token alternate when only the kebab form is supplied", () => {
		expect.assertions(1);

		const result = parseCommonOptions({ "env": "production", "github-token": "kebab-token" });

		assert(result.success);

		expect(result.data.githubToken).toBe("kebab-token");
	});

	it("should ignore the sade-reserved help and version flag aliases", () => {
		expect.assertions(1);

		const result = parseCommonOptions({
			env: "production",
			h: false,
			help: false,
			v: false,
			version: false,
		});

		expect(result.success).toBeTrue();
	});

	it("should fall back to BEDROCK_ENVIRONMENT when --env is absent", () => {
		expect.assertions(1);

		const readEnvironment = bindEnvironment({ BEDROCK_ENVIRONMENT: "staging" });
		const result = parseCommonOptions({}, readEnvironment);

		assert(result.success);

		expect(result.data.environments).toStrictEqual(["staging"]);
	});

	it("should let --env win over BEDROCK_ENVIRONMENT when both are present", () => {
		expect.assertions(1);

		const readEnvironment = bindEnvironment({ BEDROCK_ENVIRONMENT: "staging" });
		const result = parseCommonOptions({ env: "production" }, readEnvironment);

		assert(result.success);

		expect(result.data.environments).toStrictEqual(["production"]);
	});

	it("should default to a process.env reader when getEnvironment is omitted", () => {
		expect.assertions(1);

		onTestFinished(() => {
			vi.unstubAllEnvs();
		});
		vi.stubEnv("BEDROCK_ENVIRONMENT", "from-env");

		const result = parseCommonOptions({});

		assert(result.success);

		expect(result.data.environments).toStrictEqual(["from-env"]);
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
