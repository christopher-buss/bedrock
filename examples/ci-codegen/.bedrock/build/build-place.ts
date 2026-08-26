import { createDefaultSpawner } from "@bedrock-rbx/core";
import type { BuildStep } from "@bedrock-rbx/core";

/**
 * The deploy's build step: compile the roblox-ts sources and build the place
 * with Rojo, leaving the artifact at the `filePath` declared in
 * `bedrock.config.ts`.
 *
 * It runs between the provision and publish stages, after codegen has
 * rewritten `src/shared/assets`, so the published place always embeds ids that
 * exist. Bedrock owns the orchestration; this owns the build.
 *
 * Throwing here fails the deploy before anything is published. The ids
 * provisioned earlier in the run are already checkpointed to state, so a retry
 * does not mint duplicates.
 */

/** Artifact path; must match `places.start.filePath` in the config. */
const PLACE_FILE = "build/place.rbxl";

/**
 * Rojo project per environment. Development also serves a dev-only tree, so
 * the two environments build genuinely different artifacts — which is why the
 * build step is handed the environment at all.
 */
const PROJECT_FILE_BY_ENVIRONMENT: Readonly<Record<string, string>> = {
	development: "development.project.json",
	production: "production.project.json",
};

// The same child-process adapter the bedrock CLI uses: stdio inherited, launch
// failures returned rather than thrown, and the child's exit code returned on
// success.
const spawner = createDefaultSpawner();

function resolveProjectFile(environment: string): string {
	const projectFile = PROJECT_FILE_BY_ENVIRONMENT[environment];
	if (projectFile === undefined) {
		throw new Error(`no rojo project file mapped for environment "${environment}"`);
	}

	return projectFile;
}

/**
 * Runs one build command, throwing on either failure mode.
 *
 * @param command - Executable to spawn.
 * @param args - Arguments passed to the executable.
 * @returns A promise that resolves once the command exits zero.
 * @rejects {Error} When the command cannot be launched, or exits non-zero.
 */
async function runAsync(command: string, args: ReadonlyArray<string>): Promise<void> {
	const result = await spawner.spawn({ args: [...args], command, envOverrides: {} });
	if (!result.success) {
		throw new Error(`could not launch ${command}: ${result.err.kind}`);
	}

	if (result.data !== 0) {
		throw new Error(`${command} exited with code ${result.data}`);
	}
}

/**
 * Compiles the TypeScript sources and builds the place for one environment.
 *
 * @param input - The environment being deployed.
 * @returns A promise that resolves once the artifact is on disk.
 */
async function buildPlaceAsync({ environment }: { readonly environment: string }): Promise<void> {
	const projectFile = resolveProjectFile(environment);
	await runAsync("pnpm", ["exec", "rbxtsc", "--type", "game"]);
	await runAsync("rojo", ["build", projectFile, "--output", PLACE_FILE]);
}

/** Build step passed to `deploy()` in `.bedrock/deploy.ts`. */
export const build: BuildStep = buildPlaceAsync;
