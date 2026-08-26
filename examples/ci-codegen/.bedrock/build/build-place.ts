import { createDefaultSpawner } from "@bedrock-rbx/core";
import type { BuildStep } from "@bedrock-rbx/core";

// The build step runs between the provision and publish stages, after codegen
// has rewritten `src/shared/assets`, so the published place always embeds ids
// that exist. Throwing fails the deploy before anything is published; the ids
// provisioned earlier in the run are already checkpointed to state, so a retry
// does not mint duplicates.

/** Artifact path; must match `places.start.filePath` in the config. */
const PLACE_FILE = "place.rbxl";

/**
 * The roblox-ts program. `tsconfig.json` is the Node-side program for
 * `.bedrock/` and does not describe the game sources.
 */
const ROBLOX_TSCONFIG = "tsconfig.roblox.json";

/** Rojo project covering every source file, dev-only tree included. */
const SUPERSET_PROJECT_FILE = "development.project.json";

/**
 * Rojo project per environment. Development also serves a dev-only tree, so the
 * two environments build different artifacts — which is why the build step is
 * handed the environment at all.
 */
const PROJECT_FILE_BY_ENVIRONMENT: Readonly<Record<string, string>> = {
	development: SUPERSET_PROJECT_FILE,
	production: "production.project.json",
};

// The same child-process adapter the CLI uses: stdio inherited, launch failures
// returned rather than thrown.
const spawner = createDefaultSpawner();

function resolveProjectFile(environment: string): string {
	const projectFile = PROJECT_FILE_BY_ENVIRONMENT[environment];
	if (projectFile === undefined) {
		throw new Error(`no rojo project file mapped for environment "${environment}"`);
	}

	return projectFile;
}

async function runAsync(command: string, args: ReadonlyArray<string>): Promise<void> {
	const result = await spawner.spawn({ args: [...args], command, envOverrides: {} });
	if (!result.success) {
		throw new Error(`could not launch ${command}: ${result.err.kind}`);
	}

	if (result.data !== 0) {
		throw new Error(`${command} exited with code ${result.data}`);
	}
}

async function buildPlaceAsync({ environment }: { readonly environment: string }): Promise<void> {
	const projectFile = resolveProjectFile(environment);
	// rbxtsc maps compiled output through the development project because it
	// is the superset: production omits the dev tree, and rbxtsc rejects a
	// source file no `$path` covers. `rojo build` then picks what ships.
	await runAsync("pnpm", [
		"exec",
		"rbxtsc",
		"--type",
		"game",
		"--project",
		ROBLOX_TSCONFIG,
		"--rojo",
		SUPERSET_PROJECT_FILE,
	]);
	await runAsync("rojo", ["build", projectFile, "--output", PLACE_FILE]);
}

/** Build step passed to `deploy()` in `.bedrock/deploy.ts`. */
export const build: BuildStep = buildPlaceAsync;
