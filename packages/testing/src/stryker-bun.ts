import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PRELOAD_PATH = fileURLToPath(new URL("./stryker-bun-preload.ts", import.meta.url));

/**
 * Runs a package's Stryker CLI with the Bun runtime already running the
 * wrapper. Resolving the entry point directly bypasses pnpm's Windows shim,
 * which starts Node.
 *
 * @param packageDirectory - Package containing the Stryker installation and config.
 * @param args - Arguments for the Stryker CLI.
 * @returns The CLI's exit status, or undefined when it could not exit normally.
 */
export function runStryker(packageDirectory: string, args: Array<string>): number | undefined {
	const require = createRequire(resolve(packageDirectory, "package.json"));
	const packageJsonPath = require.resolve("@stryker-mutator/core/package.json");
	const entryPath = join(dirname(packageJsonPath), "bin/stryker.js");
	const result = spawnSync(process.execPath, ["--require", PRELOAD_PATH, entryPath, ...args], {
		cwd: packageDirectory,
		stdio: "inherit",
	});

	return result.status ?? undefined;
}
