import { deploy, getEnvironment } from "@bedrock-rbx/core";

import process from "node:process";

import { build } from "./build/build-place.ts";
import { emit } from "./codegen/emit.ts";

/**
 * Deploy override.
 *
 * The CLI discovers this file at `.bedrock/deploy.ts` and, instead of running
 * its built-in deploy, spawns it with `--env <environment>` in argv and the
 * credentials in the environment. Everything the CLI cannot express in a
 * config file — a build step, a custom emitter, a progress sink — is wired up
 * here, because a config file cannot hold functions.
 *
 * `deploy()` default-constructs everything not passed: the config is
 * discovered, state comes from the gist backend named in the config, and the
 * drivers read BEDROCK_API_KEY.
 *
 * Note the `.ts` extension on the relative imports below. The override runs on
 * the same runtime as the CLI, and Node requires the extension to be spelled
 * out.
 */

/**
 * Resolves the target environment and runs the deploy.
 *
 * @returns A promise that settles once the deploy finishes.
 */
async function mainAsync(): Promise<void> {
	const environment = getEnvironment();
	if (!environment.success) {
		process.stderr.write(`unable to resolve deploy environment: ${environment.err.kind}\n`);
		process.exit(1);
	}

	const result = await deploy({ build, emit, environment: environment.data });
	if (!result.success) {
		// Errors are returned, not thrown, and are stage-tagged:
		// `configLoadFailed` and `applyFailed` are different problems with
		// different fixes.
		process.stderr.write(`deploy failed at stage: ${result.err.kind}\n`);
	}

	process.exitCode = result.success ? 0 : 1;
}

mainAsync().catch((err: unknown) => {
	process.stderr.write(`deploy threw: ${err instanceof Error ? err.message : "unknown"}\n`);
	process.exit(1);
});
