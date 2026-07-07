import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it, onTestFinished, vi } from "vitest";

import { createDefaultSpawner } from "#src/cli/default-spawner";
import { dispatchOverride } from "#src/cli/dispatch-override";
import { withProbe } from "#tests/helpers/override-probe";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "overrides");
const ECHO_PROTOCOL = join(FIXTURES_ROOT, "echo-protocol.ts");
const EXIT_NON_ZERO = join(FIXTURES_ROOT, "exit-non-zero.ts");

describe("dispatch-override against the invoking runtime", () => {
	it("should forward argv exactly when configFile is supplied", async () => {
		expect.assertions(2);

		const readProbe = withProbe();
		const result = await dispatchOverride(
			{
				apiKey: "rbx-integration",
				configFile: "./bedrock.staging.config.ts",
				environment: "production",
				githubToken: "ghp_integration",
				overridePath: ECHO_PROTOCOL,
			},
			createDefaultSpawner(),
		);

		expect(result.success).toBeTrue();

		expect(readProbe().args).toStrictEqual([
			ECHO_PROTOCOL,
			"--env",
			"production",
			"--config",
			"./bedrock.staging.config.ts",
		]);
	});

	it("should set BEDROCK_API_KEY, GITHUB_TOKEN, and BEDROCK_CLI in the child's environment", async () => {
		expect.assertions(4);

		const readProbe = withProbe();
		const result = await dispatchOverride(
			{
				apiKey: "rbx-integration",
				environment: "production",
				githubToken: "ghp_integration",
				overridePath: ECHO_PROTOCOL,
			},
			createDefaultSpawner(),
		);

		expect(result.success).toBeTrue();

		const payload = readProbe();

		expect(payload.apiKey).toBe("rbx-integration");
		expect(payload.githubToken).toBe("ghp_integration");
		expect(payload.cli).toBe("1");
	});

	it("should keep secret values out of the child's argv", async () => {
		expect.assertions(2);

		const readProbe = withProbe();
		await dispatchOverride(
			{
				apiKey: "rbx-integration",
				environment: "production",
				githubToken: "ghp_integration",
				overridePath: ECHO_PROTOCOL,
			},
			createDefaultSpawner(),
		);

		const { args } = readProbe();

		expect(args).not.toContain("rbx-integration");
		expect(args).not.toContain("ghp_integration");
	});

	it("should surface a non-zero exit code as Err(nonZeroExit) carrying the code", async () => {
		expect.assertions(3);

		const result = await dispatchOverride(
			{ environment: "production", overridePath: EXIT_NON_ZERO },
			createDefaultSpawner(),
		);

		expect(result.success).toBeFalse();

		assert(!result.success);

		expect(result.err.kind).toBe("nonZeroExit");

		assert(result.err.kind === "nonZeroExit");

		expect(result.err.exitCode).toBe(3);
	});

	it("should launch the override without consulting PATH", async () => {
		expect.assertions(2);

		const readProbe = withProbe();
		vi.stubEnv("PATH", "");
		onTestFinished(() => {
			vi.unstubAllEnvs();
		});

		const result = await dispatchOverride(
			{ environment: "production", overridePath: ECHO_PROTOCOL },
			createDefaultSpawner(),
		);

		expect(result.success).toBeTrue();
		expect(readProbe().cli).toBe("1");
	});
});
