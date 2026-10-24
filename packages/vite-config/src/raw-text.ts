import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const RAW_SUFFIX = "?raw";

/**
 * Inline `import text from "./file?raw"` as a string export, matching how
 * Vite resolves the same import under Vitest, so the bundle and the binary
 * compiled from it carry the file's text.
 */
export const rawText = {
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
