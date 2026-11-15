import type { BuildStep } from "../shell/deploy.ts";
import { buildOverrideInvocation } from "./build-override-invocation.ts";
import { dispatchOverride, type SpawnOverrideError } from "./dispatch-override.ts";
import type { CommonOptions } from "./parse-options.ts";
import type { Spawner } from "./spawner.ts";

interface SpawnBuildStepInputs {
	readonly overridePath: string;
	readonly parsed: CommonOptions;
	readonly spawner: Spawner;
}

/**
 * Build the step that spawns a `.bedrock/build.ts` override for one
 * environment, throwing when the spawn fails.
 *
 * @param inputs - The override path, the parsed flags and the spawner.
 * @returns A step that runs the override for the environment it is given.
 * @rejects {Error} The spawn failed to launch or exited non-zero.
 */
export function createSpawnBuildStep({
	overridePath,
	parsed,
	spawner,
}: SpawnBuildStepInputs): BuildStep {
	return async ({ environment }) => {
		const invocation = buildOverrideInvocation({ environment, overridePath, parsed });
		const result = await dispatchOverride(invocation, spawner);
		if (!result.success) {
			const { err } = result;
			throw new Error(describeBuildSpawnFailure(err), {
				cause: err.kind === "launchFailed" ? err.cause : undefined,
			});
		}
	};
}

function describeBuildSpawnFailure(err: SpawnOverrideError): string {
	// A launch failure omits its cause message here and hands the cause Error
	// to the throw below, so the reason renders once through the shared
	// cause-chain walk rather than being flattened twice.
	return err.kind === "nonZeroExit"
		? `.bedrock/build.ts exited with code ${String(err.exitCode)}`
		: "failed to launch .bedrock/build.ts";
}
