import type { Result } from "@bedrock-rbx/ocale";

import { buildCredentialOverrides } from "./credential-environment-overrides.ts";
import type { Spawner, SpawnInvocation, SpawnLaunchCause } from "./spawner.ts";

/**
 * Parsed deploy arguments forwarded to a `.bedrock/<command>.ts` override
 * script. Credential flags are translated into env-var overrides by the
 * dispatcher so secrets never reach the child's argv.
 */
export interface OverrideInvocation {
	/** Optional `--api-key` value; translated to `BEDROCK_API_KEY` in env. */
	readonly apiKey?: string;
	/** Optional `--config <path>` value; forwarded unchanged in argv when present. */
	readonly configFile?: string;
	/** Target environment for this single override invocation. */
	readonly environment: string;
	/** Optional `--github-token` value; translated to `BEDROCK_GITHUB_TOKEN` in env. */
	readonly githubToken?: string;
	/** Path to the override script file to invoke. */
	readonly overridePath: string;
}

/**
 * Failure modes returned by {@link dispatchOverride}.
 *
 * - `launchFailed` — the child process could not be started (e.g. `bun`
 *   missing, permission denied). Wraps the {@link SpawnLaunchCause} the
 *   underlying spawner surfaced so callers can render a precise diagnostic.
 * - `nonZeroExit` — the child started, ran, and exited with a non-zero
 *   exit code. Callers should propagate `exitCode` into the CLI's own
 *   process exit code so CI failure modes mirror the override's outcome.
 */
export type SpawnOverrideError =
	| { readonly cause: SpawnLaunchCause; readonly kind: "launchFailed" }
	| { readonly exitCode: number; readonly kind: "nonZeroExit" };

/**
 * Dispatch a single `.bedrock/<command>.ts` override invocation through the
 * supplied {@link Spawner}. Encapsulates the spawn protocol:
 *
 * - argv = `[overridePath, "--env", environment]`, with `"--config", configFile`
 *   appended when supplied.
 * - `apiKey` becomes the `BEDROCK_API_KEY` env-var override; `githubToken`
 *   becomes `BEDROCK_GITHUB_TOKEN`. Neither value appears in argv.
 * - `BEDROCK_CLI=1` is always set in the env. The override's `deploy()`
 *   reads this on the `getEnv` seam to default to the clack progress
 *   adapter; absent that downstream wiring, the variable is a forward-
 *   compatible signal a future caller can act on.
 *
 * The dispatcher itself reads no ambient state: every input arrives via the
 * `invocation` argument and the `Spawner` port is the only side-effect seam.
 *
 * @param invocation - Path, environment, and parsed deploy-flag inputs.
 * @param spawner - Port the dispatcher hands the resolved
 *   {@link SpawnInvocation} to.
 * @returns `Ok(undefined)` when the child exited zero; otherwise an
 *   {@link SpawnOverrideError} discriminating launch vs non-zero exit.
 *
 * @example
 *
 * ```ts
 * import { dispatchOverride, type Spawner } from "@bedrock-rbx/core";
 *
 * const spawner: Spawner = {
 *     async spawn() {
 *         return { data: 0, success: true };
 *     },
 * };
 *
 * return dispatchOverride(
 *     {
 *         environment: "production",
 *         overridePath: "/abs/.bedrock/deploy.ts",
 *     },
 *     spawner,
 * ).then((result) => {
 *     expect(result.success).toBeTrue();
 * });
 * ```
 */
export async function dispatchOverride(
	invocation: OverrideInvocation,
	spawner: Spawner,
): Promise<Result<void, SpawnOverrideError>> {
	const args = [invocation.overridePath, "--env", invocation.environment];
	if (invocation.configFile !== undefined) {
		args.push("--config", invocation.configFile);
	}

	const credentialOverrides = buildCredentialOverrides(invocation);

	const launched = await spawner.spawn({
		args,
		command: "bun",
		envOverrides: { ...credentialOverrides, BEDROCK_CLI: "1" },
	});
	if (!launched.success) {
		return { err: { cause: launched.err.cause, kind: "launchFailed" }, success: false };
	}

	const exitCode = launched.data;
	if (exitCode !== 0) {
		return { err: { exitCode, kind: "nonZeroExit" }, success: false };
	}

	return { data: undefined, success: true };
}
