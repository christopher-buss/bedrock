import { fromAny } from "@total-typescript/shoehorn";

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { createProg } from "#src/cli/index";
import type { CapturedStreams } from "#tests/helpers/streams";
import { captureStreams } from "#tests/helpers/streams";

const require = createRequire(import.meta.url);
const manifest: { readonly version: string } = fromAny(require("../../../package.json"));

// Static import keeps the CLI module's evaluation out of any individual
// test's per-test coverage map. A `vi.resetModules() + await import(...)`
// or even a plain dynamic import inside a test would attribute every
// transitively-imported top-level statement to that test, classifying
// genuinely-static schema mutants as "covered" (and surviving) instead
// of "ignored" by `ignoreStatic`.
//
// Strip the Stryker sandbox segment so the spawned bun child resolves
// modules against the canonical source tree. Bun 1.3.13 returns the
// package directory itself (EISDIR on `node_modules/sade`) when looking
// up dependencies from inside `.stryker-tmp/sandbox-XXX/`, but resolves
// the same dependencies correctly when pointed at the real package
// path. This test only verifies that module evaluation produces no
// side effects; the mutants live in the in-process suites below, so
// using the canonical path here costs no coverage.
const CLI_ENTRY = fileURLToPath(new URL("../../../src/cli/index.ts", import.meta.url)).replace(
	/([\\/])\.stryker-tmp\1sandbox-[^\\/]+/,
	"",
);

/**
 * Capture stdout, stderr and the console for the current test, and fail it if
 * the parsed command reaches `process.exit`.
 *
 * @returns The live capture buffers.
 */
function startCapture(): CapturedStreams {
	const streams = captureStreams({ console: true });
	const exitSpy = vi.spyOn(process, "exit").mockImplementation((code): never => {
		throw new Error(`unexpected process.exit(${String(code)}) during captured run`);
	});
	onTestFinished(() => {
		exitSpy.mockRestore();
	});
	return streams;
}

describe("cli program factory", () => {
	// Spawn `bun` to import the CLI module in a fresh process so the test
	// captures real side-effects of module evaluation. An in-process
	// `vi.resetModules()` + dynamic import would attribute every
	// transitively-imported top-level statement to this test under
	// stryker's per-test coverage, classifying genuinely-static mutants
	// (e.g. schema collection regex literals) as "covered" and surfacing
	// them as Survived instead of Ignored.
	it("should not produce stdout or stderr writes during module evaluation", () => {
		expect.assertions(3);

		const result = spawnSync(
			"bun",
			["--conditions", "source", "-e", `await import(${JSON.stringify(CLI_ENTRY)})`],
			{ encoding: "utf8" },
		);

		expect(result.status).toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stderr).toBe("");
	});

	it("should print 'bedrock, <pkg.version>' when --version is parsed", () => {
		expect.assertions(2);

		const prog = createProg();

		const { stdout } = startCapture();

		prog.parse(["node", "bedrock", "--version"]);

		const captured = stdout.join("");

		expect(captured).toContain("bedrock,");
		expect(captured).toContain(manifest.version);
	});

	it("should describe the program in --help output", () => {
		expect.assertions(2);

		const prog = createProg();

		const { stdout } = startCapture();

		prog.parse(["node", "bedrock", "--help"]);

		const captured = stdout.join("");

		expect(captured).toContain("bedrock");
		expect(captured).toContain("Roblox");
	});

	it("should describe the deploy subcommand and each of its flags in 'deploy --help' output", () => {
		expect.assertions(5);

		const prog = createProg();

		const { stdout } = startCapture();

		prog.parse(["node", "bedrock", "deploy", "--help"]);

		const captured = stdout.join("");

		expect(captured).toContain("Reconcile");
		expect(captured).toContain("Target environment");
		expect(captured).toContain("Config file path");
		expect(captured).toContain("BEDROCK_API_KEY");
		expect(captured).toContain("BEDROCK_GITHUB_TOKEN");
	});

	it("should describe the build subcommand and each of its flags in 'build --help' output", () => {
		expect.assertions(5);

		const prog = createProg();

		const { stdout } = startCapture();

		prog.parse(["node", "bedrock", "build", "--help"]);

		const captured = stdout.join("");

		expect(captured).toContain(".bedrock/build.ts");
		expect(captured).toContain("Target environment");
		expect(captured).toContain("Config file path");
		expect(captured).toContain("BEDROCK_API_KEY");
		expect(captured).toContain("BEDROCK_GITHUB_TOKEN");
	});

	it("should describe the diff subcommand and each of its flags in 'diff --help' output", () => {
		expect.assertions(5);

		const prog = createProg();

		const { stdout } = startCapture();

		prog.parse(["node", "bedrock", "diff", "--help"]);

		const captured = stdout.join("");

		expect(captured).toContain("Preview the operations");
		expect(captured).toContain("Target environment");
		expect(captured).toContain("Config file path");
		expect(captured).toContain("BEDROCK_API_KEY");
		expect(captured).toContain("BEDROCK_GITHUB_TOKEN");
	});

	it("should describe the provision subcommand and each of its flags in 'provision --help' output", () => {
		expect.assertions(5);

		const prog = createProg();

		const { stdout } = startCapture();

		prog.parse(["node", "bedrock", "provision", "--help"]);

		const captured = stdout.join("");

		expect(captured).toContain("Mint assets and run codegen");
		expect(captured).toContain("Target environment");
		expect(captured).toContain("Config file path");
		expect(captured).toContain("BEDROCK_API_KEY");
		expect(captured).toContain("BEDROCK_GITHUB_TOKEN");
	});

	it("should describe the publish subcommand and each of its flags in 'publish --help' output", () => {
		expect.assertions(5);

		const prog = createProg();

		const { stdout } = startCapture();

		prog.parse(["node", "bedrock", "publish", "--help"]);

		const captured = stdout.join("");

		expect(captured).toContain("Upload on-disk place artifacts");
		expect(captured).toContain("Target environment");
		expect(captured).toContain("Config file path");
		expect(captured).toContain("BEDROCK_API_KEY");
		expect(captured).toContain("BEDROCK_GITHUB_TOKEN");
	});

	it("should describe the migrate subcommand and its --from flag in 'migrate --help' output", () => {
		expect.assertions(3);

		const prog = createProg();

		const { stdout } = startCapture();

		prog.parse(["node", "bedrock", "migrate", "--help"]);

		const captured = stdout.join("");

		expect(captured).toContain("Translate a state file from another tool");
		expect(captured).toContain("--from");
		expect(captured).toContain("Source format to migrate from");
	});
});
