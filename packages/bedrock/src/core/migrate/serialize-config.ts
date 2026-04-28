import { stringifyYAML } from "confbox";

import type { Config } from "../schema.ts";

/**
 * Inputs for {@link serializeConfig}. Format dispatch lives on
 * `configFormat` so a single function shape covers both TypeScript and
 * YAML output.
 */
export interface SerializeConfigOptions {
	/** Validated bedrock config to render. */
	readonly config: Config;
	/** Output format. TypeScript emits `defineConfig({...})`; YAML emits a `bedrock.config.yaml` body. */
	readonly configFormat: "typescript" | "yaml";
}

/**
 * Render a bedrock `Config` as the source text of a `bedrock.config.{ts,yaml}`
 * file the user can write straight to disk.
 *
 * The TypeScript branch hand-rolls a `JSON.stringify`-based emitter (no
 * AST library): the formatter quotes every property name, which is valid
 * TypeScript and sidesteps the need for an identifier-vs-quoted
 * heuristic. The YAML branch delegates to `stringifyYAML`, which already
 * drops `undefined`-valued properties so the output never surfaces
 * `null` or `~` for absent managed fields. Both shapes round-trip
 * through `loadConfig` cleanly.
 *
 * @param options - Render inputs.
 * @returns A UTF-8 source string ending with a trailing newline.
 */
export function serializeConfig(options: SerializeConfigOptions): string {
	if (options.configFormat === "yaml") {
		return `${stringifyYAML(options.config)}\n`;
	}

	const body = JSON.stringify(options.config, undefined, 2);
	return [
		'import { defineConfig } from "@bedrock/core";',
		"",
		`export default defineConfig(${body});`,
		"",
	].join("\n");
}
