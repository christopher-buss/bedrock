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

	it("should include apiKey when parsed.apiKey is defined", () => {
		expect.assertions(1);

		const invocation = buildOverrideInvocation({
			environment: "production",
			overridePath: "/abs/.bedrock/deploy.ts",
			parsed: parsedWith({ apiKey: "rbx-123" }),
		});

		expect(invocation).toContainEntry(["apiKey", "rbx-123"]);
	});

	it("should omit apiKey when parsed.apiKey is undefined", () => {
		expect.assertions(1);

		const invocation = buildOverrideInvocation({
			environment: "production",
			overridePath: "/abs/.bedrock/deploy.ts",
			parsed: parsedWith(),
		});

		expect(invocation).not.toContainKey("apiKey");
	});

	it("should include configFile when parsed.configFile is defined", () => {
		expect.assertions(1);

		const invocation = buildOverrideInvocation({
			environment: "production",
			overridePath: "/abs/.bedrock/deploy.ts",
			parsed: parsedWith({ configFile: "./bedrock.staging.config.ts" }),
		});

		expect(invocation).toContainEntry(["configFile", "./bedrock.staging.config.ts"]);
	});

	it("should omit configFile when parsed.configFile is undefined", () => {
		expect.assertions(1);

		const invocation = buildOverrideInvocation({
			environment: "production",
			overridePath: "/abs/.bedrock/deploy.ts",
			parsed: parsedWith(),
		});

		expect(invocation).not.toContainKey("configFile");
	});

	it("should include githubToken when parsed.githubToken is defined", () => {
		expect.assertions(1);

		const invocation = buildOverrideInvocation({
			environment: "production",
			overridePath: "/abs/.bedrock/deploy.ts",
			parsed: parsedWith({ githubToken: "ghp-456" }),
		});

		expect(invocation).toContainEntry(["githubToken", "ghp-456"]);
	});

	it("should omit githubToken when parsed.githubToken is undefined", () => {
		expect.assertions(1);

		const invocation = buildOverrideInvocation({
			environment: "production",
			overridePath: "/abs/.bedrock/deploy.ts",
			parsed: parsedWith(),
		});

		expect(invocation).not.toContainKey("githubToken");
	});
});
