import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { describe, it, vi } from "vitest";

import { maxStrykerWorkers } from "./stryker-adaptive-plan.ts";
import { openStrykerBudget, runStrykerInPackageAsync } from "./stryker-adaptive.ts";
import { sharedStrykerConfig } from "./stryker.ts";

const PRELOAD_PATH = fileURLToPath(new URL("./stryker-bun-preload.ts", import.meta.url));
const LAUNCHER_URL = new URL("./stryker-adaptive.ts", import.meta.url);
const PACKAGE_DIRECTORY = fileURLToPath(new URL("..", import.meta.url));
const WORKSPACE_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

async function runWithoutBudgetAsync({
	args,
	packageDirectory,
	workspaceRoot = WORKSPACE_ROOT,
}: {
	args: Array<string>;
	packageDirectory: string;
	workspaceRoot?: string;
}): Promise<number | undefined> {
	vi.stubEnv("MACHINE_BUDGET", "off");
	const budget = openStrykerBudget(workspaceRoot);
	try {
		return await runStrykerInPackageAsync({
			args,
			budget,
			packageDirectory,
			workspaceRoot,
		});
	} finally {
		budget.close();
		vi.unstubAllEnvs();
	}
}

function withScratch<T>(prefix: string, run: (directory: string) => T): T {
	const scratch = mkdtempSync(join(tmpdir(), prefix));
	try {
		return run(scratch);
	} finally {
		rmSync(scratch, { force: true, recursive: true });
	}
}

function createFakeStrykerPackage(scratch: string, status: number): void {
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
		import { writeFileSync } from "node:fs";
		const original = Error.prepareStackTrace;
		Error.prepareStackTrace = (error, frames) => original(error, frames);
		const target = {};
		Error.captureStackTrace(target);
		writeFileSync("report.json", JSON.stringify({
			args: process.argv.slice(2),
			bun: typeof process.versions.bun === "string",
			capacity: process.env.STRYKER_ADAPTIVE_INITIAL_CAPACITY,
			cwd: process.cwd(),
			formatted: target.stack.includes("    at "),
			ipc: typeof process.send,
			probe: process.env.BEDROCK_STRYKER_PROBE,
		}));
		process.exitCode = ${String(status)};
		`,
	);
}

function readReport(scratch: string): JSONValue {
	return JSON.parse(readFileSync(join(scratch, "report.json"), "utf8"));
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

	it("should keep the Stryker CLI usable when the wrapper runs under Node", async ({
		expect,
	}) => {
		expect.assertions(1);

		await expect(
			runWithoutBudgetAsync({ args: ["--version"], packageDirectory: PACKAGE_DIRECTORY }),
		).resolves.toBe(0);
	});

	it("should report a launch failure when the package directory does not exist", async ({
		expect,
	}) => {
		expect.assertions(1);

		const missingDirectory = join(import.meta.dirname, randomUUID());

		await expect(
			runWithoutBudgetAsync({ args: ["--version"], packageDirectory: missingDirectory }),
		).resolves.toBeUndefined();
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
		{ name: "checker", nodeArgs: sharedStrykerConfig.checkerNodeArgs, runtime: "bun" },
		{ name: "test runner", nodeArgs: sharedStrykerConfig.testRunnerNodeArgs, runtime: "bun" },
		{ name: "checker", nodeArgs: sharedStrykerConfig.checkerNodeArgs, runtime: "node" },
		{ name: "test runner", nodeArgs: sharedStrykerConfig.testRunnerNodeArgs, runtime: "node" },
	])(
		"should preload the formatter in $runtime $name workers",
		({ nodeArgs, runtime }, { expect }) => {
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
					runtime,
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
			expect(JSON.parse(result.stdout)).toStrictEqual({
				bun: runtime === "bun",
				formatted: true,
			});
		},
	);

	it("should launch the package CLI with the preload, an ipc channel and the leased capacity", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(3);

		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		const scratch = mkdtempSync(join(tmpdir(), "stryker node package "));
		onTestFinished(() => {
			errors.mockRestore();
			rmSync(scratch, { force: true, recursive: true });
		});
		createFakeStrykerPackage(scratch, 7);
		vi.stubEnv("BEDROCK_STRYKER_PROBE", "inherited");
		const args = ["run", "stryker.config.ts", "--mutate", "src/value.ts:1-2"];
		const status = await runWithoutBudgetAsync({
			args,
			packageDirectory: scratch,
			workspaceRoot: dirname(dirname(scratch)),
		});
		const workers = String(maxStrykerWorkers(availableParallelism()));
		const project = `${basename(dirname(scratch))}/${basename(scratch)}`;

		expect(status).toBe(7);
		expect(readReport(scratch)).toStrictEqual({
			args,
			bun: typeof process.versions.bun === "string",
			capacity: workers,
			cwd: scratch,
			formatted: true,
			ipc: "function",
			probe: "inherited",
		});
		expect(errors).toHaveBeenCalledWith(`stryker: leased ${workers} worker(s) for ${project}`);
	});

	it.for([0, 7])(
		"should launch the package CLI under Bun and return exit status %i",
		(status, { expect }) => {
			expect.assertions(3);

			const { directory, report, result } = withScratch("stryker bun package ", (scratch) => {
				createFakeStrykerPackage(scratch, status);
				const childResult = spawnSync(
					"bun",
					[
						"--eval",
						`
					import { openStrykerBudget, runStrykerInPackageAsync } from ${JSON.stringify(LAUNCHER_URL.href)};
					const workspaceRoot = ${JSON.stringify(dirname(scratch))};
					const budget = openStrykerBudget(workspaceRoot);
					process.exitCode = await runStrykerInPackageAsync({
						args: ["run", "stryker.config.ts", "--force", "--mutate", "src/value.ts:1-2"],
						budget,
						packageDirectory: ${JSON.stringify(scratch)},
						workspaceRoot,
					}) ?? 1;
					budget.close();
					`,
					],
					{
						encoding: "utf8",
						env: { ...process.env, MACHINE_BUDGET: "off" },
						timeout: 10_000,
					},
				);

				return { directory: scratch, report: readReport(scratch), result: childResult };
			});

			const workers = String(maxStrykerWorkers(availableParallelism()));

			expect(result.status).toBe(status);
			expect(result.stderr.split("\n", 1)[0]).toBe(
				`stryker: leased ${workers} worker(s) for ${basename(directory)}`,
			);
			expect(report).toStrictEqual({
				args: ["run", "stryker.config.ts", "--force", "--mutate", "src/value.ts:1-2"],
				bun: true,
				capacity: workers,
				cwd: directory,
				formatted: true,
				ipc: "function",
			});
		},
	);
});
