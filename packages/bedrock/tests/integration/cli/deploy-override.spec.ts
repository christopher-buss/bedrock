import { createProg, type ProgDeps } from "#src/cli/index";
import type { Config } from "#src/core/schema";
import type { BedrockState } from "#src/core/state";
import { fakeClackPort } from "#tests/helpers/clack";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished, vi } from "vitest";

type DeployFunc = NonNullable<ProgDeps["deploy"]>;
type ExitFunc = NonNullable<ProgDeps["exit"]>;
type LoadConfigFunc = NonNullable<ProgDeps["loadConfig"]>;

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "overrides");
const ECHO_PROTOCOL = join(FIXTURES_ROOT, "echo-protocol.ts");
const EXIT_NON_ZERO = join(FIXTURES_ROOT, "exit-non-zero.ts");

const fakeConfig = { environments: { production: {} } } satisfies Config;

interface OverrideProject {
	readonly overridePath: string;
	readonly projectRoot: string;
}

interface Harness {
	readonly clack: NonNullable<ProgDeps["clack"]>;
	readonly deploy: ReturnType<typeof vi.fn<DeployFunc>>;
	readonly exitPromise: Promise<number>;
	readonly prog: ReturnType<typeof createProg>;
}

function emptyState(environment: string): BedrockState {
	return { environment, resources: [], version: 1 };
}

/**
 * Materialize a real `<root>/.bedrock/deploy.ts` from a committed fixture so
 * the test exercises discoverOverride against a genuine on-disk layout rather
 * than a stubbed path.
 * @param sourceFixture - Committed override script copied into the temp project.
 * @returns The temp project root and the absolute override path within it.
 */
function withOverrideProject(sourceFixture: string): OverrideProject {
	const projectRoot = mkdtempSync(join(tmpdir(), "bedrock-override-disco-"));
	const overridePath = join(projectRoot, ".bedrock", "deploy.ts");
	mkdirSync(join(projectRoot, ".bedrock"));
	copyFileSync(sourceFixture, overridePath);
	onTestFinished(() => {
		rmSync(projectRoot, { force: true, recursive: true });
	});
	return { overridePath, projectRoot };
}

function withProbe(): () => JSONValue {
	const directory = mkdtempSync(join(tmpdir(), "bedrock-override-probe-"));
	const file = join(directory, "probe.json");
	vi.stubEnv("OVERRIDE_PROBE_OUTPUT", file);
	onTestFinished(() => {
		vi.unstubAllEnvs();
		rmSync(directory, { force: true, recursive: true });
	});
	return () => JSON.parse(readFileSync(file, "utf8"));
}

function buildHarness(projectRoot: string): Harness {
	let resolveExit!: (code: number) => void;
	const exitPromise = new Promise<number>((resolve) => {
		resolveExit = resolve;
	});
	const exit = vi.fn<ExitFunc>((code) => {
		resolveExit(code);
	});
	const loadConfig = vi.fn<LoadConfigFunc>(async () => ({ data: fakeConfig, success: true }));
	const deploy = vi.fn<DeployFunc>(async () => {
		return { data: emptyState("production"), success: true };
	});
	const clack = fakeClackPort();
	const prog = createProg({ clack, deploy, exit, loadConfig, projectRoot });
	return { clack, deploy, exitPromise, prog };
}

describe("cli deploy override discovery end-to-end", () => {
	it("should discover and execute .bedrock/deploy.ts via real bun, forwarding the spawn protocol", async () => {
		expect.assertions(4);

		const project = withOverrideProject(ECHO_PROTOCOL);
		const readProbe = withProbe();
		const harness = buildHarness(project.projectRoot);

		harness.prog.parse(["node", "bedrock", "deploy", "--env", "production"]);
		const code = await harness.exitPromise;

		expect(code).toBe(0);
		expect(harness.deploy).not.toHaveBeenCalled();
		// bun canonicalizes the script path in argv[1] (on macOS the temp dir's
		// `/var` symlink resolves to `/private/var`), so compare against the
		// real path of the file discoverOverride resolved.
		expect(readProbe()).toStrictEqual({
			args: [realpathSync(project.overridePath), "--env", "production"],
			cli: "1",
		});
		expect(harness.clack.outro).toHaveBeenCalledExactlyOnceWith("deploy succeeded");
	});

	it("should propagate a non-zero override exit discovered on disk as exit 1", async () => {
		expect.assertions(3);

		const project = withOverrideProject(EXIT_NON_ZERO);
		const harness = buildHarness(project.projectRoot);

		harness.prog.parse(["node", "bedrock", "deploy", "--env", "production"]);
		const code = await harness.exitPromise;

		expect(code).toBe(1);
		expect(harness.clack.logError).toHaveBeenCalledExactlyOnceWith(
			"production: override exited with code 3",
		);
		expect(harness.clack.cancel).toHaveBeenCalledExactlyOnceWith("deploy failed");
	});
});
