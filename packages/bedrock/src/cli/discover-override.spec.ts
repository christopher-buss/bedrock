import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { discoverOverride } from "./discover-override.ts";

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
});
