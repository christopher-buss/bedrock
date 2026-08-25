import type { BuildStep } from "@bedrock-rbx/core";

import { spawn } from "node:child_process";

/**
 * The deploy's build step: compile the roblox-ts sources and build the place
 * with Rojo, leaving the artifact at the `filePath` declared in
 * `bedrock.config.ts`.
 *
 * It runs between the provision and publish stages, after codegen has
 * rewritten `src/shared/assets`, so the published place always embeds ids that
 * exist. Bedrock owns the orchestration; this owns the build.
 */

/** Artifact path; must match `places.start.filePath` in the config. */
const PLACE_FILE = "build/place.rbxl";

/**
 * Rojo project per environment. Development also serves a dev-only tree, so
 * the two builds are genuinely different artifacts.
 */
const PROJECT_FILE_BY_ENVIRONMENT: Readonly<Record<string, string>> = {
	development: "development.project.json",
	production: "production.project.json",
};

/** Side effects the build step drives, injected so it stays unit-testable. */
export interface BuildDependencies {
	/** Runs a command, rejecting when it exits non-zero. */
	readonly run: (command: string, parameters: ReadonlyArray<string>) => Promise<void>;
}

/**
 * Builds the deploy's build step from injectable side effects.
 *
 * A throw here fails the deploy before anything is published, but the ids
 * provisioned earlier in the run are already checkpointed to state, so a retry
 * does not mint duplicates.
 *
 * @param dependencies - The command runner to drive.
 * @returns A build step suitable for `DeployOptions.build`.
 */
export function createBuildStep(dependencies: BuildDependencies): BuildStep {
	return async ({ environment }) => {
		const projectFile = resolveProjectFile(environment);
		await dependencies.run("pnpm", ["exec", "rbxtsc", "--type", "game"]);
		await dependencies.run("rojo", ["build", projectFile, "--output", PLACE_FILE]);
	};
}

function resolveProjectFile(environment: string): string {
	const projectFile = PROJECT_FILE_BY_ENVIRONMENT[environment];
	if (projectFile === undefined) {
		throw new Error(`no rojo project file mapped for environment "${environment}"`);
	}

	return projectFile;
}

async function runCommandAsync(command: string, parameters: ReadonlyArray<string>): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, [...parameters], { stdio: "inherit" });
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}

			reject(new Error(`${command} exited with code ${code ?? "signal"}`));
		});
	});
}

/** Build step wired to the real toolchain. */
export const build = createBuildStep({ run: runCommandAsync });
