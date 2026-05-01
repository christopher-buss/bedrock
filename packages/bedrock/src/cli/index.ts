import sade from "sade";
import type { Sade } from "sade";

import manifest from "../../package.json" with { type: "json" };
import type { buildStatePort as defaultBuildStatePort } from "../shell/build-state-port.ts";
import type { deploy as defaultDeploy } from "../shell/deploy.ts";
import type { loadConfig as defaultLoadConfig } from "../shell/load-config.ts";
import type { migrateMantleState as defaultMigrateMantleState } from "../shell/migrate-mantle-state.ts";
import type { previewDiff as defaultPreviewDiff } from "../shell/preview-diff.ts";
import { deployCommand } from "./commands/deploy.ts";
import { diffCommand } from "./commands/diff.ts";
import { migrateCommand } from "./commands/migrate.ts";
import type { MigratePromptPort } from "./migrate-prompt-port.ts";
import type { ClackPort } from "./render.ts";

export { createClackPort } from "./render.ts";

const PROGRAM_NAME = "bedrock";
const PROGRAM_DESCRIBE = "Infrastructure-as-Code deployment tool for Roblox";

/**
 * Dependency seam for the bedrock CLI program. Every slot is optional;
 * command actions resolve a real default when a slot is omitted.
 */
export interface ProgDeps {
	/** Builds a `StatePort` from a resolved state config; defaults to the public `buildStatePort`. */
	readonly buildStatePort?: typeof defaultBuildStatePort;
	/** Output port; defaults to a real `@clack/prompts` adapter inside command actions. */
	readonly clack?: ClackPort;
	/** Reconciles config to live state; defaults to the public `deploy`. */
	readonly deploy?: typeof defaultDeploy;
	/** Process exit handle; defaults to `process.exit` so tests can intercept termination. The production default never returns; test stubs are free to return void. */
	readonly exit?: (code: number) => void;
	/** Project config loader; defaults to the public `loadConfig`. */
	readonly loadConfig?: typeof defaultLoadConfig;
	/** Mantle state migrator; defaults to the public `migrateMantleState`. */
	readonly migrateMantleState?: typeof defaultMigrateMantleState;
	/** Domain-specific prompt port for the migrate command; defaults to `createDefaultMigratePromptPort()`. */
	readonly migratePromptPort?: MigratePromptPort;
	/** Read-only preview of operations; defaults to the internal `previewDiff` shell helper. */
	readonly previewDiff?: typeof defaultPreviewDiff;
	/** File-write seam used by the migrate command to emit the bedrock config file; defaults to `node:fs/promises.writeFile`. */
	readonly writeFile?: (path: string, contents: string) => Promise<void>;
}

/**
 * Construct the bedrock CLI program. Pure factory: no `process.argv` parsing,
 * no clack output, no exits. Callers (the `run.ts` shim, integration tests)
 * call `.parse()` on the returned sade instance.
 * @param deps - Dependency overrides for command actions. Each command
 *   resolves its own defaults from any omitted slots.
 * @returns A configured sade program with the bedrock name, description, and
 *   the currently installed `@bedrock/core` version, plus the registered
 *   `deploy`, `diff`, and `migrate` commands.
 */
export function createProg(deps: ProgDeps = {}): Sade {
	const prog = sade(PROGRAM_NAME).describe(PROGRAM_DESCRIBE).version(manifest.version);

	prog.command("deploy")
		.describe("Reconcile a project's resources against the configured environment(s)")
		.option("--env", "Target environment (repeat for multiple)")
		.option("--config", "Config file path (overrides discovery)")
		.option("--api-key", "Override the ROBLOX_API_KEY environment variable")
		.option("--github-token", "Override the GITHUB_TOKEN environment variable")
		.action(deployCommand(deps));

	prog.command("diff")
		.describe("Preview the operations a deploy would apply, without writing state")
		.option("--env", "Target environment (repeat for multiple)")
		.option("--config", "Config file path (overrides discovery)")
		.option("--api-key", "Override the ROBLOX_API_KEY environment variable")
		.option("--github-token", "Override the GITHUB_TOKEN environment variable")
		.action(diffCommand(deps));

	prog.command("migrate [stateFilePath]")
		.describe("Translate a state file from another tool into a bedrock project")
		.option("--from", "Source format to migrate from (prompted if omitted)")
		.action(migrateCommand(deps));

	return prog;
}
