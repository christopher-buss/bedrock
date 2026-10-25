import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

import { runStryker } from "./stryker-bun.ts";
import { sharedStrykerConfig } from "./stryker.ts";

const PRELOAD_PATH = fileURLToPath(new URL("./stryker-bun-preload.ts", import.meta.url));
const LAUNCHER_URL = new URL("./stryker-bun.ts", import.meta.url);

function withScratch<T>(prefix: string, run: (directory: string) => T): T {
	const scratch = mkdtempSync(join(tmpdir(), prefix));
	try {
		return run(scratch);
	} finally {
		rmSync(scratch, { force: true, recursive: true });
	}
}

async function captureNodeStacksAsync(): Promise<{
	native: string | undefined;
	plain: string | undefined;
}> {
	const original = Error.prepareStackTrace;
	try {
		await import("./stryker-bun-preload.ts");
		const native = new Error("native");
		const plain: { stack?: string } = {};
		Error.captureStackTrace(plain);
		return {
			native: native.stack?.split("\n", 1)[0],
			plain: plain.stack?.split("\n", 1)[0],
		};
	} finally {
		Error.prepareStackTrace = original;
	}
}

describe("stryker on Bun", () => {
	it("should preserve Node stacks for native errors and format other objects", async ({
		expect,
	}) => {
		expect.assertions(1);
		await expect(captureNodeStacksAsync()).resolves.toStrictEqual({
			native: "Error: native",
			plain: "[object Object]",
		});
	});

	it("should keep the Stryker CLI usable when the wrapper runs under Node", ({ expect }) => {
		expect.assertions(1);
		expect(runStryker(fileURLToPath(new URL("..", import.meta.url)), ["--version"])).toBe(0);
	});

	it("should report a launch failure when the package directory does not exist", ({ expect }) => {
		expect.assertions(1);

		const missingDirectory = join(import.meta.dirname, randomUUID());

		expect(runStryker(missingDirectory, ["--version"])).toBeUndefined();
	});

	it("should format Error-like objects after Babel wraps the stack formatter", ({ expect }) => {
		expect.assertions(2);

		const result = spawnSync(
			"bun",
			[
				"--require",
				PRELOAD_PATH,
				"--eval",
				`
				const original = Error.prepareStackTrace;
				Error.prepareStackTrace = (error, frames) => original(error, frames);
				const plain = {};
				const inherited = Object.create(Error.prototype);
				Error.captureStackTrace(plain);
				Error.captureStackTrace(inherited);
				console.log(JSON.stringify({
					real: new Error("native").stack.split("\\n")[0],
					plain: plain.stack.includes("    at "),
					inherited: inherited.stack.includes("    at "),
				}));
				`,
			],
			{ encoding: "utf8", timeout: 10_000 },
		);

		expect({ status: result.status, stderr: result.stderr }).toStrictEqual({
			status: 0,
			stderr: "",
		});
		expect(JSON.parse(result.stdout)).toStrictEqual({
			inherited: true,
			plain: true,
			real: "Error: native",
		});
	});

	it.for([
		{ name: "checker", nodeArgs: sharedStrykerConfig.checkerNodeArgs },
		{ name: "test runner", nodeArgs: sharedStrykerConfig.testRunnerNodeArgs },
	])("should preload the formatter in $name workers", ({ nodeArgs }, { expect }) => {
		expect.assertions(2);

		const result = withScratch("stryker bun worker ", (scratch) => {
			const childPath = join(scratch, "worker.mjs");
			writeFileSync(
				childPath,
				`
				const original = Error.prepareStackTrace;
				Error.prepareStackTrace = (error, frames) => original(error, frames);
				const target = Object.create(Error.prototype);
				Error.captureStackTrace(target);
				process.send({ bun: typeof process.versions.bun === "string", formatted: target.stack.includes("    at ") });
				`,
			);

			return spawnSync(
				"bun",
				[
					"--require",
					PRELOAD_PATH,
					"--eval",
					`
						import { fork } from "node:child_process";
						const child = fork(${JSON.stringify(childPath)}, [], {
							execArgv: ${JSON.stringify(nodeArgs)},
							stdio: ["ignore", "inherit", "inherit", "ipc"],
						});
						child.on("message", message => {
							console.log(JSON.stringify(message));
							child.disconnect();
						});
						child.on("exit", code => { process.exitCode = code ?? 1; });
						`,
				],
				{ encoding: "utf8", timeout: 10_000 },
			);
		});

		expect({ status: result.status, stderr: result.stderr }).toStrictEqual({
			status: 0,
			stderr: "",
		});
		expect(JSON.parse(result.stdout)).toStrictEqual({ bun: true, formatted: true });
	});

	it.for([0, 7])(
		"should launch the package CLI under Bun and return exit status %i",
		(status, { expect }) => {
			expect.assertions(2);

			const { directory, result } = withScratch("stryker bun package ", (scratch) => {
				const coreDirectory = join(scratch, "node_modules/@stryker-mutator/core");
				mkdirSync(join(coreDirectory, "bin"), { recursive: true });
				writeFileSync(join(scratch, "package.json"), "{}");
				writeFileSync(
					join(coreDirectory, "package.json"),
					JSON.stringify({
						exports: { "./package.json": "./package.json" },
						type: "module",
					}),
				);
				writeFileSync(
					join(coreDirectory, "bin/stryker.js"),
					`
			const original = Error.prepareStackTrace;
			Error.prepareStackTrace = (error, frames) => original(error, frames);
			const target = {};
			Error.captureStackTrace(target);
			console.log(JSON.stringify({
				args: process.argv.slice(2),
				bun: typeof process.versions.bun === "string",
				cwd: process.cwd(),
				formatted: target.stack.includes("    at "),
			}));
			process.exitCode = ${String(status)};
			`,
				);

				const childResult = spawnSync(
					"bun",
					[
						"--eval",
						`
					import { runStryker } from ${JSON.stringify(LAUNCHER_URL.href)};
					process.exitCode = runStryker(${JSON.stringify(scratch)}, [
						"run", "stryker.config.ts", "--force", "--mutate", "src/value.ts:1-2",
					]) ?? 1;
					`,
					],
					{ encoding: "utf8", timeout: 10_000 },
				);

				return { directory: scratch, result: childResult };
			});

			expect({ status: result.status, stderr: result.stderr }).toStrictEqual({
				status,
				stderr: "",
			});
			expect(JSON.parse(result.stdout)).toStrictEqual({
				args: ["run", "stryker.config.ts", "--force", "--mutate", "src/value.ts:1-2"],
				bun: true,
				cwd: directory,
				formatted: true,
			});
		},
	);
});
