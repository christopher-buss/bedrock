import { readFile } from "node:fs/promises";
import { createHighlighter, type Highlighter } from "shiki";
import type { Plugin } from "vite";

const QUERY = "?highlighted";
const THEME = "vitesse-dark";

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
			const source = await readFile(filePath, "utf8");
			const highlighter = await getHighlighter();
			const html = highlighter.codeToHtml(source, {
				lang: detectLang(filePath),
				theme: THEME,
			});

			this.addWatchFile(filePath);
			return `export default ${JSON.stringify(html)};`;
		},
		async resolveId(source, importer) {
			if (!source.endsWith(QUERY)) {
				return;
			}

			const base = source.slice(0, -QUERY.length);
			const resolved = await this.resolve(base, importer, { skipSelf: true });
			if (!resolved) {
				return;
			}

			return `${resolved.id}${QUERY}`;
		},
	};
}

async function getHighlighter(): Promise<Highlighter> {
	highlighterPromise ??= createHighlighter({
		langs: ["typescript", "bash"],
		themes: [THEME],
	});
	return highlighterPromise;
}

function detectLang(filePath: string): string {
	if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) {
		return "typescript";
	}

	return "bash";
}
