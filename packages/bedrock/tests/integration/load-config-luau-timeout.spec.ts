import { loadConfig } from "@bedrock-rbx/core";
import { HAS_LUTE } from "@bedrock-rbx/testing/lute";

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it } from "vitest";

const WORKSPACE_TEMP_ROOT = join(
	dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))),
	"node_modules",
	".cache",
);

async function withTemporaryDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
	mkdirSync(WORKSPACE_TEMP_ROOT, { recursive: true });
	const directory = mkdtempSync(join(WORKSPACE_TEMP_ROOT, "bedrock-luau-timeout-"));
	try {
		return await run(directory);
	} finally {
		rmSync(directory, { force: true, recursive: true });
	}
}

describe("loadConfig + real lute", () => {
	it.skipIf(!HAS_LUTE)(
		"should bound a hanging Luau config with the bootstrap timeout",
		async () => {
			expect.assertions(1);

			await withTemporaryDirectory(async (cwd) => {
				writeFileSync(
					join(cwd, "bedrock.config.luau"),
					["while true do end", ""].join("\n"),
				);

				const result = await loadConfig({ cwd });

				assert(!result.success);

				expect(result.err.kind).toBe("parseFailed");
			});
		},
		15_000,
	);
});
