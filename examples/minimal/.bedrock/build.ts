import { createDefaultSpawner, getEnvironment } from "@bedrock-rbx/core";

import process from "node:process";

/**
 * Build override for `bedrock build`, and — because this project enables
 * codegen — the build step the fused `bedrock deploy` runs between its
 * provision and publish stages.
 *
 * The CLI discovers this file at `.bedrock/build.ts` and spawns it on the same
 * runtime it is running on, with `--env <environment>` in argv. Its one job is
 * to leave a built artifact at the `filePath` every place in
 * `bedrock.config.ts` declares. Bedrock never builds anything itself; see the
 * README for why the build has to happen inside the deploy.
 */

const PROJECT_FILE = "default.project.json";
const OUTPUT_FILE = "build/place.rbxl";

// The same child-process adapter the bedrock CLI uses to spawn this script:
// stdio inherited, launch failures returned rather than thrown, and the
// child's exit code returned on success.
const spawner = createDefaultSpawner();

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

	const built = await spawner.spawn({
		args: ["build", PROJECT_FILE, "--output", OUTPUT_FILE],
		command: "rojo",
		envOverrides: {},
	});

	// Two failure modes, not one: the launch itself can fail (rojo missing
	// from PATH), or rojo can run and exit non-zero.
	if (!built.success) {
		process.stderr.write(`could not launch rojo: ${built.err.kind}\n`);
		process.exit(1);
	}

	if (built.data !== 0) {
		process.stderr.write(`rojo exited with code ${built.data}\n`);
		process.exit(1);
	}
}

mainAsync().catch((err: unknown) => {
	process.stderr.write(`build failed: ${err instanceof Error ? err.message : "unknown"}\n`);
	process.exit(1);
});
