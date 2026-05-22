import { describe, expect, it } from "vitest";

import { buildOverrideInvocation } from "./build-override-invocation.ts";
import type { CommonOptions } from "./parse-options.ts";

function parsedWith(overrides: Partial<CommonOptions> = {}): CommonOptions {
	return { environments: ["production"], ...overrides };
}

describe(buildOverrideInvocation, () => {
	it("should always include environment and overridePath", () => {
		expect.assertions(2);

		const invocation = buildOverrideInvocation({
			environment: "production",
			overridePath: "/abs/.bedrock/deploy.ts",
			parsed: parsedWith(),
		});

		expect(invocation.environment).toBe("production");
		expect(invocation.overridePath).toBe("/abs/.bedrock/deploy.ts");
	});

	it.for<{ entry: [string, string]; label: string; parsed: CommonOptions }>([
		{
			entry: ["apiKey", "rbx-123"],
			label: "apiKey",
			parsed: parsedWith({ apiKey: "rbx-123" }),
		},
		{
			entry: ["configFile", "./bedrock.staging.config.ts"],
			label: "configFile",
			parsed: parsedWith({ configFile: "./bedrock.staging.config.ts" }),
		},
		{
			entry: ["githubToken", "ghp-456"],
			label: "githubToken",
			parsed: parsedWith({ githubToken: "ghp-456" }),
		},
	])("should include $label when parsed.$label is defined", ({ entry, parsed }) => {
		expect.assertions(1);

		const invocation = buildOverrideInvocation({
			environment: "production",
			overridePath: "/abs/.bedrock/deploy.ts",
			parsed,
		});

		expect(invocation).toContainEntry(entry);
	});

	it.for<{ key: "apiKey" | "configFile" | "githubToken" }>([
		{ key: "apiKey" },
		{ key: "configFile" },
		{ key: "githubToken" },
	])("should omit $key when parsed.$key is undefined", ({ key }) => {
		expect.assertions(1);

		const invocation = buildOverrideInvocation({
			environment: "production",
			overridePath: "/abs/.bedrock/deploy.ts",
			parsed: parsedWith(),
		});

		expect(invocation).not.toContainKey(key);
	});
});
