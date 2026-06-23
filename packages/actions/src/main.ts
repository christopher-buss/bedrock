import * as core from "@actions/core";

import process from "node:process";

import { runCommitBackAction } from "./commit-back-action.ts";
import { createGitExec } from "./git-exec.ts";

async function main(): Promise<void> {
	await runCommitBackAction({
		getEnv: (name) => process.env[name],
		git: createGitExec(),
		readInput: (name) => core.getInput(name),
		setOutput: (name, value) => {
			core.setOutput(name, value);
		},
	});
}

main().catch((err: unknown) => {
	core.setFailed(err instanceof Error ? err.message : String(err));
});
