import { readFile } from "node:fs/promises";
import { createHighlighter, type Highlighter } from "shiki";
import type { Plugin } from "vite";

import { BEDROCK_WARM } from "./shiki-theme.ts";

const QUERY = "?highlighted";
const THEME = "bedrock-warm";

let highlighterPromise: Promise<Highlighter> | undefined;

/**
 * Vite plugin that exposes `import "./file.ts?highlighted"` virtual modules.
 * Reads the source file at build time, runs Shiki, and returns the resulting
 * HTML string as the module's default export. Lets landing-page code samples
 * stay as real type-checked `.ts` files while rendering as pre-highlighted
 * HTML in the browser bundle.
 *
 * @returns A Vite plugin that resolves the `?highlighted` query suffix.
 */
export function shikiHighlightPlugin(): Plugin {
	return {
		name: "bedrock:shiki-highlight",
		async load(id) {
			if (!id.endsWith(QUERY)) {
				return;
			}

			const filePath = id.slice(0, -QUERY.length);
			try {
				this.addWatchFile(filePath);
				return await highlightToModule(filePath);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				this.error(`shiki-highlight: ${filePath}: ${message}`);
			}
		},
		async resolveId(source, importer) {
			if (!source.endsWith(QUERY)) {
				return;
			}

			const base = source.slice(0, -QUERY.length);
			const resolved = await this.resolve(base, importer, { skipSelf: true });
			return resolved ? `${resolved.id}${QUERY}` : undefined;
		},
	};
}

async function getHighlighter(): Promise<Highlighter> {
	highlighterPromise ??= createHighlighter({
		langs: ["typescript", "bash"],
		themes: [BEDROCK_WARM],
	});
	return highlighterPromise;
}

function detectLang(filePath: string): string {
	if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) {
		return "typescript";
	}

	if (filePath.endsWith(".sh") || filePath.endsWith(".bash")) {
		return "bash";
	}

	throw new Error(`shiki-highlight: unsupported extension for ${filePath}`);
}

/**
 * Read a source file and return its Shiki-highlighted HTML wrapped as a
 * default-export module string.
 *
 * @param filePath - Absolute path to the source file (no `?highlighted` query).
 * @returns Module source that default-exports the highlighted HTML string.
 */
async function highlightToModule(filePath: string): Promise<string> {
	const source = await readFile(filePath, "utf8");
	const highlighter = await getHighlighter();
	const html = highlighter.codeToHtml(source, {
		lang: detectLang(filePath),
		theme: THEME,
	});
	return `export default ${JSON.stringify(html)};`;
}
