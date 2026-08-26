import { deploy, getEnvironment } from "@bedrock-rbx/core";

import process from "node:process";

import { build } from "./build/build-place.ts";
import { emit } from "./codegen/emit.ts";

// Deploy override. The CLI discovers this file at `.bedrock/deploy.ts` and
// spawns it with `--env <environment>` in argv rather than running its built-in
// deploy, so a build step and a custom emitter — neither of which a config file
// can hold — are wired into `deploy()` here. Everything not passed is
// default-constructed from the discovered config.
//
// The relative imports above spell out the `.ts` extension because the override
// runs on the same runtime as the CLI, and Node requires it.

async function mainAsync(): Promise<void> {
	const environment = getEnvironment();
	if (!environment.success) {
		process.stderr.write(`unable to resolve deploy environment: ${environment.err.kind}\n`);
		process.exit(1);
	}

	const result = await deploy({ build, emit, environment: environment.data });
	if (!result.success) {
		// Errors are returned rather than thrown, tagged with the stage that
		// failed: `configLoadFailed` and `applyFailed` want different fixes.
		process.stderr.write(`deploy failed at stage: ${result.err.kind}\n`);
		process.exitCode = 1;
	}
}

mainAsync().catch((err) => {
	process.stderr.write(`deploy threw: ${err instanceof Error ? err.message : "unknown"}\n`);
	process.exit(1);
});
