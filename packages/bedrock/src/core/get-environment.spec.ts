import process from "node:process";
import { assert, describe, expect, it, onTestFinished, vi } from "vitest";

import { getEnvironment } from "./get-environment.ts";

function empty(): string | undefined {
	return undefined;
}

describe(getEnvironment, () => {
	it("should return the environment name when argv contains a single --env flag", () => {
		expect.assertions(2);

		const result = getEnvironment(["--env", "production"], empty);

		expect(result.success).toBeTrue();

		assert(result.success);

		expect(result.data).toBe("production");
	});

	it("should fall back to BEDROCK_ENVIRONMENT when no --env flag is present", () => {
		expect.assertions(2);

		const result = getEnvironment([], (name) =>
			name === "BEDROCK_ENVIRONMENT" ? "staging" : undefined,
		);

		expect(result.success).toBeTrue();

		assert(result.success);

		expect(result.data).toBe("staging");
	});

	it("should let --env win over BEDROCK_ENVIRONMENT when both are present", () => {
		expect.assertions(2);

		const result = getEnvironment(["--env", "production"], () => "staging");

		expect(result.success).toBeTrue();

		assert(result.success);

		expect(result.data).toBe("production");
	});

	it("should return the missingEnvironment error when no --env flag and no env-var binding", () => {
		expect.assertions(2);

		const result = getEnvironment([], empty);

		expect(result.success).toBeFalse();

		assert(!result.success);

		expect(result.err).toStrictEqual({ kind: "missingEnvironment" });
	});

	it("should ignore a trailing --env with no following value and report missingEnvironment", () => {
		expect.assertions(2);

		const result = getEnvironment(["--env"], empty);

		expect(result.success).toBeFalse();

		assert(!result.success);

		expect(result.err).toStrictEqual({ kind: "missingEnvironment" });
	});

	it("should return the multipleEnvironments error carrying every --env value when more than one is supplied", () => {
		expect.assertions(2);

		const result = getEnvironment(
			["--env", "production", "--env", "staging", "--env", "preview"],
			empty,
		);

		expect(result.success).toBeFalse();

		assert(!result.success);

		expect(result.err).toStrictEqual({
			kind: "multipleEnvironments",
			values: ["production", "staging", "preview"],
		});
	});

	it("should source argv from process.argv.slice(2) when argv is omitted", () => {
		expect.assertions(2);

		const originalArgv = process.argv;
		onTestFinished(() => {
			process.argv = originalArgv;
		});
		// Leading `--env` lives in the runner positions (node + script path) and
		// must be skipped; only the second `--env` belongs to the script.
		process.argv = ["node", "--env", "trap", "--env", "preview"];

		const result = getEnvironment();

		expect(result.success).toBeTrue();

		assert(result.success);

		expect(result.data).toBe("preview");
	});

	it("should source the env reader from process.env when readEnvironment is omitted", () => {
		expect.assertions(2);

		const originalArgv = process.argv;
		onTestFinished(() => {
			process.argv = originalArgv;
			vi.unstubAllEnvs();
		});
		process.argv = ["node", "script"];
		vi.stubEnv("BEDROCK_ENVIRONMENT", "from-env");

		const result = getEnvironment();

		expect(result.success).toBeTrue();

		assert(result.success);

		expect(result.data).toBe("from-env");
	});
});
