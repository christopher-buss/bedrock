import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import process from "node:process";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const manifest = require("../../../package.json") as { readonly version: string };

interface CapturedStreams {
	readonly stderr: ReadonlyArray<string>;
	readonly stdout: ReadonlyArray<string>;
}

function startCapture(): () => CapturedStreams {
	const stdout: Array<string> = [];
	const stderr: Array<string> = [];

	const stdoutSpy = vi
		.spyOn(process.stdout, "write")
		.mockImplementation((chunk: string | Uint8Array): boolean => {
			stdout.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
			return true;
		});
	const stderrSpy = vi
		.spyOn(process.stderr, "write")
		.mockImplementation((chunk: string | Uint8Array): boolean => {
			stderr.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
			return true;
		});
	const logSpy = vi
		.spyOn(console, "log")
		.mockImplementation((...messages: ReadonlyArray<unknown>) => {
			stdout.push(`${messages.map((message) => String(message)).join(" ")}\n`);
		});
	const errorSpy = vi
		.spyOn(console, "error")
		.mockImplementation((...messages: ReadonlyArray<unknown>) => {
			stderr.push(`${messages.map((message) => String(message)).join(" ")}\n`);
		});
	const exitSpy = vi.spyOn(process, "exit").mockImplementation((code): never => {
		throw new Error(`unexpected process.exit(${String(code)}) during captured run`);
	});

	return () => {
		stdoutSpy.mockRestore();
		stderrSpy.mockRestore();
		logSpy.mockRestore();
		errorSpy.mockRestore();
		exitSpy.mockRestore();
		return { stderr, stdout };
	};
}

describe("cli program factory", () => {
	it("should not produce stdout or stderr writes during module evaluation", async () => {
		expect.assertions(2);

		vi.resetModules();
		const collect = startCapture();
		try {
			await import("#src/cli/index");
		} finally {
			const { stderr, stdout } = collect();

			expect(stdout.join("")).toBe("");
			expect(stderr.join("")).toBe("");
		}
	});

	it("should print 'bedrock, <pkg.version>' when --version is parsed", async () => {
		expect.assertions(2);

		const { createProg } = await import("#src/cli/index");
		const prog = createProg();

		const collect = startCapture();
		try {
			prog.parse(["node", "bedrock", "--version"]);
		} finally {
			const { stdout } = collect();
			const captured = stdout.join("");

			expect(captured).toContain("bedrock,");
			expect(captured).toContain(manifest.version);
		}
	});

	it("should describe the program in --help output", async () => {
		expect.assertions(2);

		const { createProg } = await import("#src/cli/index");
		const prog = createProg();

		const collect = startCapture();
		try {
			prog.parse(["node", "bedrock", "--help"]);
		} finally {
			const { stdout } = collect();
			const captured = stdout.join("");

			expect(captured).toContain("bedrock");
			expect(captured).toContain("Roblox");
		}
	});
});
