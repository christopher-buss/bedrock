import { getEnvironment } from "@bedrock-rbx/core";

import { spawn } from "node:child_process";
import process from "node:process";

/**
 * Build override for `bedrock build`, and — because this project enables
 * codegen — the build step the fused `bedrock deploy` runs between its
 * provision and publish stages.
 *
 * The CLI discovers this file at `.bedrock/build.ts` and spawns it on the same
 * runtime it is running on, with `--env <environment>` in argv. Its one job is
 * to leave a built artifact at the `filePath` every place in
 * `bedrock.config.ts` declares. Bedrock never builds anything itself.
 *
 * Why the deploy has to build at all: provisioning a new developer product
 * mints an id that did not exist when the place was last built, so the place
 * has to be rebuilt on top of the regenerated `resources.luau` before it is
 * published. That is why the build sits inside the deploy, between provision
 * and publish.
 */

const PROJECT_FILE = "default.project.json";
const OUTPUT_FILE = "build/place.rbxl";

/**
 * Runs a command, resolving on exit code 0 and rejecting otherwise.
 *
 * @param command - Executable to spawn.
 * @param parameters - Arguments passed to the executable.
 * @returns A promise that settles once the child process exits.
 */
async function runAsync(command: string, parameters: ReadonlyArray<string>): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, [...parameters], { stdio: "inherit" });
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}

			reject(new Error(`${command} exited with code ${code ?? "signal"}`));
		});
	});
}

/**
 * Resolves the target environment and builds the place.
 *
 * @returns A promise that settles once the build finishes.
 */
async function mainAsync(): Promise<void> {
	// `getEnvironment` reads the `--env` flag the CLI passed, falling back to
	// the BEDROCK_ENVIRONMENT variable, so this script works standalone too.
	const environment = getEnvironment();
	if (!environment.success) {
		process.stderr.write(`unable to resolve build environment: ${environment.err.kind}\n`);
		process.exit(1);
	}

	process.stderr.write(`building ${OUTPUT_FILE} for ${environment.data}\n`);
	await runAsync("rojo", ["build", PROJECT_FILE, "--output", OUTPUT_FILE]);
}

mainAsync().catch((err: unknown) => {
	process.stderr.write(`build failed: ${err instanceof Error ? err.message : "unknown"}\n`);
	process.exit(1);
});
