import sade from "sade";
import type { Sade } from "sade";

import manifest from "../../package.json" with { type: "json" };
import type { PluginRegistry } from "../core/plugin-registry.ts";
import type { StateBackendFetch } from "../core/plugin.ts";
import type { ProgressPort } from "../ports/progress-port.ts";
import type { buildStatePort as defaultBuildStatePort } from "../shell/build-state-port.ts";
import type {
	deploy as defaultDeploy,
	provision as defaultProvision,
	publish as defaultPublish,
} from "../shell/deploy.ts";
import type { forceReleaseStateLockAsync as defaultForceReleaseStateLock } from "../shell/force-release-state-lock.ts";
import type { loadProjectAsync as defaultLoadProject } from "../shell/load-config.ts";
import type { migrateMantleState as defaultMigrateMantleState } from "../shell/migrate-mantle-state.ts";
import type { moveStateAsync as defaultMoveState } from "../shell/move-state.ts";
import type { previewDiffAsync as defaultPreviewDiff } from "../shell/preview-diff.ts";
import { buildCommand } from "./commands/build.ts";
import { deployCommand } from "./commands/deploy.ts";
import { diffCommand } from "./commands/diff.ts";
import { migrateCommand } from "./commands/migrate.ts";
import { provisionCommand } from "./commands/provision.ts";
import { publishCommand } from "./commands/publish.ts";
import { stateMoveCommand } from "./commands/state-move.ts";
import { statePushCommand } from "./commands/state-push.ts";
import { stateUnlockCommand } from "./commands/state-unlock.ts";
import type { discoverOverride as defaultDiscoverOverride } from "./discover-override.ts";
import type { MigratePromptPort } from "./migrate-prompt-port.ts";
import type { ClackPort } from "./render.ts";
import type { Spawner } from "./spawner.ts";

export { createClackPort } from "./clack-port.ts";

const PROGRAM_NAME = "bedrock";
const PROGRAM_DESCRIBE = "Infrastructure-as-Code deployment tool for Roblox";

/**
 * Dependency seam for the bedrock CLI program. Every slot is optional;
 * command actions resolve a real default when a slot is omitted.
 */
export interface ProgDeps {
	/**
	 * Builds a `StatePort` from a resolved state config; defaults to the
	 * public `buildStatePort`.
	 */
	readonly buildStatePort?: typeof defaultBuildStatePort;
	/**
	 * Output port; defaults to a real `@clack/prompts` adapter inside command
	 * actions.
	 */
	readonly clack?: ClackPort;
	/** Reconciles config to upstream state; defaults to the public `deploy`. */
	readonly deploy?: typeof defaultDeploy;
	/**
	 * Discovers a `.bedrock/<command>.ts` override path; defaults to the real
	 * `discoverOverride`.
	 */
	readonly discoverOverride?: typeof defaultDiscoverOverride;
	/**
	 * Process exit handle; defaults to `process.exit` so tests can intercept
	 * termination. The production default never returns; test stubs are free to
	 * return void.
	 */
	readonly exit?: (code: number) => void;
	/**
	 * Transport a plugin fetching the previous tool's state routes its
	 * requests through; omitted, the plugin falls back to the runtime's own
	 * `fetch`.
	 */
	readonly fetch?: StateBackendFetch;
	/**
	 * Takes an environment's hold away; defaults to the public
	 * `forceReleaseStateLockAsync`.
	 */
	readonly forceReleaseStateLock?: typeof defaultForceReleaseStateLock;
	/**
	 * Project loader; defaults to the public `loadProjectAsync`, whose
	 * result carries both the validated config and what its `plugins`
	 * entries declared.
	 */
	readonly loadProject?: typeof defaultLoadProject;
	/** Mantle state migrator; defaults to the public `migrateMantleState`. */
	readonly migrateMantleState?: typeof defaultMigrateMantleState;
	/**
	 * Domain-specific prompt port for the migrate command; defaults to
	 * `createDefaultMigratePromptPort()`.
	 */
	readonly migratePromptPort?: MigratePromptPort;
	/**
	 * Directory-create seam used by the migrate command for the local-dump
	 * backend and by a reconcile command dumping an unsaved state; defaults
	 * to `node:fs/promises.mkdir` with `recursive: true`.
	 */
	readonly mkdir?: (path: string) => Promise<void>;
	/**
	 * Relocates state between **Backend**s; defaults to the public
	 * `moveStateAsync`.
	 */
	readonly moveState?: typeof defaultMoveState;
	/**
	 * What the loaded plugins declared, which decides the **Backend**s the
	 * migrate command offers beyond the builtins. Defaults to what a
	 * discoverable project config registered, or to nothing when the
	 * project has no config yet.
	 */
	readonly plugins?: PluginRegistry;
	/**
	 * Read-only preview of operations; defaults to the internal `previewDiff`
	 * shell helper.
	 */
	readonly previewDiff?: typeof defaultPreviewDiff;
	/**
	 * Progress port that receives per-env deploy outcomes; defaults to the
	 * clack-backed adapter.
	 */
	readonly progress?: ProgressPort;
	/**
	 * Project root passed to override discovery and used to locate the
	 * recovery dumps; defaults to `process.cwd()`.
	 */
	readonly projectRoot?: string;
	/**
	 * Runs the asset stage plus codegen; defaults to the public `provision`.
	 */
	readonly provision?: typeof defaultProvision;
	/**
	 * Publishes on-disk artifacts for pending-rebuild places; defaults to the
	 * public `publish`.
	 */
	readonly publish?: typeof defaultPublish;
	/**
	 * File-read seam used by `state push` to read a recovery dump; defaults
	 * to `node:fs/promises.readFile` in UTF-8.
	 */
	readonly readTextFile?: (path: string) => Promise<string>;
	/**
	 * File-delete seam used by `state push` to consume a recovery dump it
	 * pushed; defaults to `node:fs/promises.rm` with `force: true`.
	 */
	readonly removeFile?: (path: string) => Promise<void>;
	/**
	 * Child-process spawner used to launch override scripts; defaults to
	 * `createDefaultSpawner()`.
	 */
	readonly spawner?: Spawner;
	/**
	 * File-write seam used by the migrate command to emit the bedrock config
	 * file and by a reconcile command dumping an unsaved state; defaults to
	 * `node:fs/promises.writeFile`.
	 */
	readonly writeFile?: (path: string, contents: string) => Promise<void>;
}

/**
 * The reconcile-style subcommands, each sharing the `withCommonOptions` flag
 * surface. `migrate` is registered separately because it takes a positional
 * argument and its own flags.
 */
const RECONCILE_COMMANDS = [
	{
		name: "deploy",
		action: deployCommand,
		describe: "Reconcile a project's resources against the configured environment(s)",
	},
	{
		name: "build",
		action: buildCommand,
		describe: "Run the project's .bedrock/build.ts override to produce place artifacts",
	},
	{
		name: "diff",
		action: diffCommand,
		describe: "Preview the operations a deploy would apply, without writing state",
	},
	{
		name: "provision",
		action: provisionCommand,
		describe: "Mint assets and run codegen without building or publishing a place",
	},
	{
		name: "publish",
		action: publishCommand,
		describe: "Upload on-disk place artifacts pending a rebuild, without minting or codegen",
	},
] as const;

/**
 * Construct the bedrock CLI program. Pure factory: no `process.argv` parsing,
 * no clack output, no exits. Callers (the `run.ts` shim, integration tests)
 * call `.parse()` on the returned sade instance.
 * @param deps - Dependency overrides for command actions. Each command
 *   resolves its own defaults from any omitted slots.
 * @returns A configured sade program with the bedrock name, description, and
 *   the currently installed `@bedrock-rbx/core` version, plus the registered
 *   `build`, `deploy`, `diff`, `provision`, `publish`, `state push`,
 *   `state unlock`, and `migrate` commands.
 */
export function createProg(deps: ProgDeps = {}): Sade {
	const prog = sade(PROGRAM_NAME).describe(PROGRAM_DESCRIBE).version(manifest.version);

	for (const { name, action, describe } of RECONCILE_COMMANDS) {
		withCommonOptions(prog.command(name).describe(describe)).action(action(deps));
	}

	withCommonOptions(
		prog
			.command("state push")
			.describe("Push a state file a failed write dumped locally to the configured backend"),
	).action(statePushCommand(deps));

	withCommonOptions(
		prog
			.command("state unlock")
			.describe("Take an environment's state lock away, whichever run is holding it"),
	).action(stateUnlockCommand(deps));

	withCommonOptions(
		prog
			.command("state move")
			.describe("Move an environment's state onto another backend, leaving the source copy")
			.option("--to", "Backend to move onto (gist, or one a loaded plugin declared)")
			.option("--to-<key>", "One destination coordinate, named as that backend declares it")
			.option("--force", "Overwrite state the destination already holds"),
	).action(stateMoveCommand(deps));

	prog.command("migrate [stateFilePath]")
		.describe("Translate a state file from another tool into a bedrock project")
		.option("--from", "Source format to migrate from (mantle; prompted if omitted)")
		.action(migrateCommand(deps));

	return prog;
}

/**
 * Register the environment/config/credential flags shared by every
 * reconcile-style subcommand (`deploy`, `build`, `diff`, `provision`,
 * `publish`) onto the sade command the caller has just opened via
 * `prog.command(...).describe(...)`. Keeping the flag names and descriptions in
 * one place stops the registrations from drifting apart. `migrate` has its own
 * flag surface and is registered without this helper.
 * @param command - The sade instance positioned on the command being defined.
 * @returns The same sade instance so the caller can chain `.action(...)`.
 */
function withCommonOptions(command: Sade): Sade {
	return command
		.option("--env", "Target environment (repeat for multiple)")
		.option("--config", "Config file path (overrides discovery)")
		.option("--api-key", "Override the BEDROCK_API_KEY environment variable")
		.option("--github-token", "Override the BEDROCK_GITHUB_TOKEN environment variable");
}
