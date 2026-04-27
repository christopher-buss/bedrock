import type { Config } from "../schema.ts";

/**
 * Render a bedrock `Config` as TypeScript source text, using
 * `defineConfig({...})` so the output is loadable by `loadConfig` and
 * carries the same type-checking ergonomics a hand-authored
 * `bedrock.config.ts` would.
 *
 * Hand-rolls a `JSON.stringify`-based emitter (no AST library): the
 * formatter quotes every property name, which is valid TypeScript and
 * sidesteps the need for an identifier-vs-quoted heuristic. `undefined`
 * fields are dropped because the bedrock schema treats absent and
 * `undefined` interchangeably for managed fields, and the `defineConfig`
 * loader accepts either shape.
 *
 * @param config - Validated bedrock config to render.
 * @returns A UTF-8 TypeScript source string ending with a trailing newline.
 */
export function serializeConfig(config: Config): string {
	const body = JSON.stringify(config, undefined, 2);
	return [
		'import { defineConfig } from "@bedrock/core";',
		"",
		`export default defineConfig(${body});`,
		"",
	].join("\n");
}
