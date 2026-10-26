import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PRELOAD_PATH = fileURLToPath(new URL("./stryker-bun-preload.ts", import.meta.url));

/**
 * Starts a package's Stryker CLI with the Bun runtime already running the
 * wrapper. Resolving the entry point directly bypasses pnpm's Windows shim,
 * which starts Node. The child inherits stdout and stderr and gets an IPC
 * channel, which the patched Stryker reads resize messages from.
 *
 * @param options - What to start.
 * @param options.args - Arguments for the Stryker CLI.
 * @param options.environment - Variables the Stryker process sees.
 * @param options.packageDirectory - Package containing the Stryker
 *   installation and config.
 * @returns The running Stryker process.
 */
export function spawnStryker(options: {
	args: ReadonlyArray<string>;
	environment: NodeJS.ProcessEnv;
	packageDirectory: string;
}): ChildProcess {
	const { args, packageDirectory } = options;
	const require = createRequire(resolve(packageDirectory, "package.json"));
	const packageJsonPath = require.resolve("@stryker-mutator/core/package.json");
	const entryPath = join(dirname(packageJsonPath), "bin/stryker.js");
	return spawn(process.execPath, ["--require", PRELOAD_PATH, entryPath, ...args], {
		cwd: packageDirectory,
		env: options.environment,
		stdio: ["inherit", "inherit", "inherit", "ipc"],
	});
}
