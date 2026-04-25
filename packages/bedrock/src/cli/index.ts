import sade from "sade";
import type { Sade } from "sade";

import manifest from "../../package.json" with { type: "json" };
import type { diff as defaultDiff } from "../core/diff.ts";
import type { deploy as defaultDeploy } from "../shell/deploy.ts";
import type { loadConfig as defaultLoadConfig } from "../shell/load-config.ts";
import type { ClackPort } from "./render.ts";

export { createClackPort } from "./render.ts";

const PROGRAM_NAME = "bedrock";
const PROGRAM_DESCRIBE = "Infrastructure-as-Code deployment tool for Roblox";

/**
 * Dependency seam for the bedrock CLI program. Every slot is optional;
 * command actions resolve a real default when a slot is omitted.
 */
export interface ProgDeps {
	/** Output port; defaults to a real `@clack/prompts` adapter inside command actions. */
	readonly clack?: ClackPort;
	/** Reconciles config to live state; defaults to the public `deploy`. */
	readonly deploy?: typeof defaultDeploy;
	/** Pure desired-vs-current operation list builder; defaults to the public `diff`. */
	readonly diff?: typeof defaultDiff;
	/** Process exit handle; defaults to `process.exit` so tests can intercept termination. */
	readonly exit?: (code: number) => never;
	/** Project config loader; defaults to the public `loadConfig`. */
	readonly loadConfig?: typeof defaultLoadConfig;
}

/**
 * Construct the bedrock CLI program. Pure factory: no `process.argv` parsing,
 * no clack output, no exits. Callers (the `run.ts` shim, integration tests)
 * call `.parse()` on the returned sade instance.
 * @param _deps - Dependency overrides for command actions. Reserved for the
 *   `bedrock deploy` and `bedrock diff` slices; unused while no commands are
 *   registered.
 * @returns A configured sade program with the bedrock name, description, and
 *   the currently installed `@bedrock/core` version.
 */
export function createProg(_deps?: ProgDeps): Sade {
	return sade(PROGRAM_NAME).describe(PROGRAM_DESCRIBE).version(manifest.version);
}
