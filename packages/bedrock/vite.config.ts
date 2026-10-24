import { sharedConfig } from "@bedrock-rbx/vite-config";

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mergeConfig } from "vite-plus";

const RAW_SUFFIX = "?raw";

/**
 * Inline `import text from "./file?raw"` as a string export, matching how
 * Vite resolves the same import under Vitest, so the bundle and the binary
 * compiled from it carry the file's text.
 */
const rawText = {
	name: "bedrock:raw-text",
	async load(id: string): Promise<string | undefined> {
		if (!id.endsWith(RAW_SUFFIX)) {
			return undefined;
		}

		const text = await readFile(id.slice(0, -RAW_SUFFIX.length), "utf8");
		return `export default ${JSON.stringify(text)};`;
	},
	resolveId(source: string, importer: string | undefined): string | undefined {
		if (importer === undefined || !source.endsWith(RAW_SUFFIX)) {
			return undefined;
		}

		return resolve(dirname(importer), source);
	},
};

export default mergeConfig(sharedConfig, {
	pack: {
		copy: [{ from: "src/luau/config.luau", to: "dist/luau" }],
		entry: ["src/index.ts", "src/cli/run.ts", "src/config.ts"],
		exports: {
			...sharedConfig.pack.exports,
			bin: {
				bedrock: "./src/cli/run.ts",
			},
		},
		plugins: [rawText],
	},
	test: {
		coverage: {
			exclude: [...sharedConfig.test.coverage.exclude, "src/cli/run.ts"],
		},
	},
});
