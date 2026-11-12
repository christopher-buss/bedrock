import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

import { createGithubPort } from "../src/github.ts";
import { runGateAsync } from "../src/runner.ts";

const local = {
	command: (binary: string, args: Array<string>) => {
		return execFileSync(binary, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	},
	read: (path: string) => readFileSync(path, "utf8"),
	root: process.cwd(),
};
runGateAsync({ args: process.argv, env: process.env, factory: createGithubPort, local })
	.then(({ code, output }) => {
		process.stdout.write(`${output}\n`);
		process.exitCode = code;
	})
	.catch((err: unknown) => {
		console.error(String(err));
		process.exitCode = 1;
	});
