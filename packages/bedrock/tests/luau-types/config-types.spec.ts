import { HAS_LUTE } from "@bedrock-rbx/testing/lute";

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { describe, it, type TestContext } from "vitest";

import {
	nodeMkdirAsync,
	nodeReadOptionalTextFileAsync,
	nodeWriteTextFileAsync,
} from "#src/cli/fs-seams";
import { LUAU_CONFIG_SOURCE } from "#src/luau/config-source";
import { setupLuauTypesAsync } from "#src/shell/setup-luau-types";

const LUTE = process.env["BEDROCK_LUTE_PATH"] ?? "lute";

/**
 * Set up a fresh project the way `bedrock setup` does, drop a fixture in as
 * its `bedrock.config.luau`, and run `lute check` over it.
 *
 * @param fixture - File name under `fixtures/`.
 * @param onTestFinished - The calling test's cleanup hook.
 * @returns The exit status and combined output of `lute check`.
 */
async function checkFixtureAsync(
	fixture: string,
	onTestFinished: TestContext["onTestFinished"],
): Promise<{ output: string; status: number | undefined }> {
	const projectRoot = mkdtempSync(join(tmpdir(), "bedrock-luau-types-"));
	onTestFinished(() => {
		rmSync(projectRoot, { force: true, recursive: true });
	});
	await setupLuauTypesAsync({
		bundledSource: LUAU_CONFIG_SOURCE,
		mkdir: nodeMkdirAsync,
		projectRoot,
		readOptionalTextFile: nodeReadOptionalTextFileAsync,
		writeFile: nodeWriteTextFileAsync,
	});
	const configPath = join(projectRoot, "bedrock.config.luau");
	copyFileSync(new URL(`fixtures/${fixture}`, import.meta.url), configPath);

	const result = spawnSync(LUTE, ["check", configPath], { encoding: "utf8" });
	return { output: `${result.stdout}${result.stderr}`, status: result.status ?? undefined };
}

describe.skipIf(!HAS_LUTE)("luau config types under lute check", () => {
	it("should accept retirement markers on root passes and overlays", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(1);

		const result = await checkFixtureAsync("retire.config.luau", onTestFinished);

		expect(result).toStrictEqual({ output: "", status: 0 });
	});

	it("should accept untrack markers on root entries and environment overlays", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(1);

		const result = await checkFixtureAsync("untrack.config.luau", onTestFinished);

		expect(result).toStrictEqual({ output: "", status: 0 });
	});

	it("should accept a minimal config built with defineConfig", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(1);

		const result = await checkFixtureAsync("minimal.config.luau", onTestFinished);

		expect(result).toStrictEqual({ output: "", status: 0 });
	});

	it("should accept the none price and redacted override objects", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(1);

		const result = await checkFixtureAsync("none-and-redacted.config.luau", onTestFinished);

		expect(result).toStrictEqual({ output: "", status: 0 });
	});

	it("should accept movedFrom on every kind and environment overlay", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(1);

		const result = await checkFixtureAsync("renames.config.luau", onTestFinished);

		expect(result).toStrictEqual({ output: "", status: 0 });
	});

	it("should identify a string price rejected inside an environment overlay", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(3);

		const result = await checkFixtureAsync("wrong-type.config.luau", onTestFinished);

		expect(result.status).toBe(1);
		expect(result.output).toContain("bedrock.config.luau:6:");
		expect(result.output).toContain("price: string");
	});
});
