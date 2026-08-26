import { describe, expect, it } from "vitest";

import { recoveryPushCommand } from "./recovery-file.ts";

describe(recoveryPushCommand, () => {
	it("should name the environment whose dump would be pushed", () => {
		expect.assertions(1);

		expect(recoveryPushCommand("production")).toBe("bedrock state push --env production");
	});

	it("should carry the config path the failed run was given", () => {
		expect.assertions(1);

		expect(recoveryPushCommand("production", "./bedrock.staging.config.ts")).toBe(
			"bedrock state push --env production --config ./bedrock.staging.config.ts",
		);
	});

	it("should quote a path the shell would otherwise split", () => {
		expect.assertions(1);

		expect(recoveryPushCommand("production", "./my project/bedrock.config.ts")).toBe(
			'bedrock state push --env production --config "./my project/bedrock.config.ts"',
		);
	});

	it("should quote an environment the shell would otherwise split", () => {
		expect.assertions(1);

		expect(recoveryPushCommand("pre release")).toBe('bedrock state push --env "pre release"');
	});

	it("should escape what stays live inside double quotes", () => {
		expect.assertions(1);

		expect(recoveryPushCommand("production", './a"b$c`d\\e.ts')).toBe(
			'bedrock state push --env production --config "./a\\"b\\$c\\`d\\\\e.ts"',
		);
	});
});
