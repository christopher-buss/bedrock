import process from "node:process";

import { createGithubPort } from "../src/github.ts";
import { runWriterAsync } from "../src/runner.ts";

runWriterAsync(process.env, createGithubPort)
	.then((output) => process.stdout.write(`${output}\n`))
	.catch((err: unknown) => {
		console.error(String(err));
		process.exitCode = 1;
	});
