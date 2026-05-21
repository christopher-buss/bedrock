import { createDefaultSpawner } from "#src/cli/default-spawner";
import { dispatchOverride } from "#src/cli/dispatch-override";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it, vi } from "vitest";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "overrides");
const ECHO_PROTOCOL = join(FIXTURES_ROOT, "echo-protocol.ts");
const EXIT_NON_ZERO = join(FIXTURES_ROOT, "exit-non-zero.ts");

interface ProbePayload {
	readonly apiKey?: string;
	readonly args: ReadonlyArray<string>;
	readonly cli?: string;
	readonly githubToken?: string;
}

interface ProbeRun {
	readonly cleanup: () => void;
	readonly read: () => ProbePayload;
}

function withProbe(): ProbeRun {
	const directory = mkdtempSync(join(tmpdir(), "bedrock-override-probe-"));
	const file = join(directory, "probe.json");
	vi.stubEnv("OVERRIDE_PROBE_OUTPUT", file);

	return {
		cleanup: () => {
			vi.unstubAllEnvs();
			rmSync(directory, { force: true, recursive: true });
		},
		read: () => JSON.parse(readFileSync(file, "utf8")) as unknown as ProbePayload,
	};
}

describe("dispatch-override against real bun", () => {
	it("should forward argv exactly when configFile is supplied", async () => {
		expect.assertions(2);

		const probe = withProbe();
		try {
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

			expect(probe.read().args).toStrictEqual([
				ECHO_PROTOCOL,
				"--env",
				"production",
				"--config",
				"./bedrock.staging.config.ts",
			]);
		} finally {
			probe.cleanup();
		}
	});

	it("should set BEDROCK_API_KEY, GITHUB_TOKEN, and BEDROCK_CLI in the child's environment", async () => {
		expect.assertions(4);

		const probe = withProbe();
		try {
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

			const payload = probe.read();

			expect(payload.apiKey).toBe("rbx-integration");
			expect(payload.githubToken).toBe("ghp_integration");
			expect(payload.cli).toBe("1");
		} finally {
			probe.cleanup();
		}
	});

	it("should keep secret values out of the child's argv", async () => {
		expect.assertions(2);

		const probe = withProbe();
		try {
			await dispatchOverride(
				{
					apiKey: "rbx-integration",
					environment: "production",
					githubToken: "ghp_integration",
					overridePath: ECHO_PROTOCOL,
				},
				createDefaultSpawner(),
			);

			const { args } = probe.read();

			expect(args).not.toContain("rbx-integration");
			expect(args).not.toContain("ghp_integration");
		} finally {
			probe.cleanup();
		}
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

	it("should surface a missing executable as Err(launchFailed) with an ENOENT cause", async () => {
		expect.assertions(3);

		const originalPath = process.env["PATH"];
		vi.stubEnv("PATH", "");
		try {
			const result = await dispatchOverride(
				{ environment: "production", overridePath: ECHO_PROTOCOL },
				createDefaultSpawner(),
			);

			expect(result.success).toBeFalse();

			assert(!result.success);

			expect(result.err.kind).toBe("launchFailed");

			assert(result.err.kind === "launchFailed");

			expect(result.err.cause.code).toBe("ENOENT");
		} finally {
			if (originalPath !== undefined) {
				vi.stubEnv("PATH", originalPath);
			}
		}
	});
});
