import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { StatProbe } from "./discover-override.ts";
import { discoverOverride, discoverOverrideWith } from "./discover-override.ts";

function throwingStat(error: unknown): StatProbe {
	return () => {
		throw error;
	};
}

function errnoError(code: string): NodeJS.ErrnoException {
	const error: NodeJS.ErrnoException = new Error(`synthetic ${code}`);
	error.code = code;
	return error;
}

// Walking up from a temp file inside the workspace tree finds @bedrock-rbx/core
// via the workspace root's node_modules, regardless of pnpm's hoist decisions.
// node_modules/.cache is the conventional location for tool ephemera and is
// already gitignored.
const WORKSPACE_TEMP_ROOT = join(
	dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
	"node_modules",
	".cache",
);

async function withTemporaryDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
	mkdirSync(WORKSPACE_TEMP_ROOT, { recursive: true });
	const directory = mkdtempSync(join(WORKSPACE_TEMP_ROOT, "bedrock-discover-override-"));
	try {
		return await run(directory);
	} finally {
		rmSync(directory, { force: true, recursive: true });
	}
}

describe(discoverOverride, () => {
	it("should return the resolved absolute path when the override file exists", async () => {
		expect.assertions(1);

		await withTemporaryDirectory(async (cwd) => {
			mkdirSync(join(cwd, ".bedrock"));
			const expected = join(cwd, ".bedrock", "deploy.ts");
			writeFileSync(expected, "export default () => {};");

			expect(discoverOverride(cwd, "deploy")).toBe(expected);
		});
	});

	it("should return undefined when the .bedrock directory does not exist", async () => {
		expect.assertions(1);

		await withTemporaryDirectory(async (cwd) => {
			expect(discoverOverride(cwd, "deploy")).toBeUndefined();
		});
	});

	it("should return undefined when .bedrock exists but the command file is absent", async () => {
		expect.assertions(1);

		await withTemporaryDirectory(async (cwd) => {
			mkdirSync(join(cwd, ".bedrock"));

			expect(discoverOverride(cwd, "deploy")).toBeUndefined();
		});
	});

	it("should return undefined when a different command override exists in .bedrock", async () => {
		expect.assertions(1);

		await withTemporaryDirectory(async (cwd) => {
			mkdirSync(join(cwd, ".bedrock"));
			writeFileSync(join(cwd, ".bedrock", "diff.ts"), "export default () => {};");

			expect(discoverOverride(cwd, "deploy")).toBeUndefined();
		});
	});

	it("should return undefined when the candidate path exists as a directory rather than a file", async () => {
		expect.assertions(1);

		await withTemporaryDirectory(async (cwd) => {
			mkdirSync(join(cwd, ".bedrock", "deploy.ts"), { recursive: true });

			expect(discoverOverride(cwd, "deploy")).toBeUndefined();
		});
	});

	it("should return undefined when .bedrock itself is a regular file rather than a directory", async () => {
		expect.assertions(1);

		await withTemporaryDirectory(async (cwd) => {
			writeFileSync(join(cwd, ".bedrock"), "not a directory");

			expect(discoverOverride(cwd, "deploy")).toBeUndefined();
		});
	});

	it.for<[label: string, command: string]>([
		["empty string", ""],
		["parent traversal", "../etc/passwd"],
		["embedded traversal", "deploy/../diff"],
		["path separator", "foo/bar"],
		["leading dot", "..bedrock"],
		["uppercase", "Deploy"],
		["leading hyphen", "-rf"],
	])(
		"should return undefined for a malformed command name (%s) without touching the filesystem",
		async ([, command]) => {
			expect.assertions(1);

			await withTemporaryDirectory(async (cwd) => {
				// A `.bedrock/` directory with a permissive file present
				// proves the early-return path skipped the stat — otherwise
				// path traversal could resolve into something real.
				mkdirSync(join(cwd, ".bedrock"));
				writeFileSync(join(cwd, ".bedrock", "diff.ts"), "export default () => {};");

				expect(discoverOverride(cwd, command)).toBeUndefined();
			});
		},
	);

	it.for<[label: string, code: string]>([
		["ENOENT", "ENOENT"],
		["ENOTDIR", "ENOTDIR"],
	])(
		"should return undefined when the stat probe rejects with an absence-style error code (%s)",
		([, code]) => {
			expect.assertions(1);

			const stat = throwingStat(errnoError(code));

			expect(
				discoverOverrideWith({ command: "deploy", projectRoot: "/project", stat }),
			).toBeUndefined();
		},
	);

	it.for<[label: string, code: string]>([
		["EACCES", "EACCES"],
		["EPERM", "EPERM"],
		["EBUSY", "EBUSY"],
	])(
		"should rethrow when the stat probe rejects with a non-absence error code (%s) so dispatch cannot silently fall back to the built-in command",
		([, code]) => {
			expect.assertions(1);

			const error = errnoError(code);
			const stat = throwingStat(error);

			expect(() =>
				discoverOverrideWith({ command: "deploy", projectRoot: "/project", stat }),
			).toThrow(error);
		},
	);

	it("should rethrow when the stat probe throws a non-Error value", () => {
		expect.assertions(1);

		const stat = throwingStat("not an Error instance");

		expect(() =>
			discoverOverrideWith({ command: "deploy", projectRoot: "/project", stat }),
		).toThrow("not an Error instance");
	});

	it("should rethrow when the stat probe throws an Error without a code property", () => {
		expect.assertions(1);

		const stat = throwingStat(new Error("no code attached"));

		expect(() =>
			discoverOverrideWith({ command: "deploy", projectRoot: "/project", stat }),
		).toThrow("no code attached");
	});
});
