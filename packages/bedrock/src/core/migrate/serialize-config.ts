import { stringifyYAML } from "confbox";

import type { Config } from "../schema.ts";

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

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
 * The TypeScript branch emits a hand-authored object literal: tab-indented,
 * with double-quoted string values and unquoted keys for valid identifier
 * names (quoted otherwise). The YAML branch delegates to `stringifyYAML`,
 * which already drops `undefined`-valued properties so the output never
 * surfaces `null` or `~` for absent managed fields. Both shapes round-trip
 * through `loadConfig` cleanly.
 *
 * @param options - Render inputs.
 * @returns A UTF-8 source string ending with a trailing newline.
 */
export function serializeConfig(options: SerializeConfigOptions): string {
	if (options.configFormat === "yaml") {
		return `${stringifyYAML(options.config)}\n`;
	}

	const body = renderObjectLiteral(options.config, 0);
	return [
		'import { defineConfig } from "@bedrock/core/config";',
		"",
		`export default defineConfig(${body});`,
		"",
	].join("\n");
}

function renderValue(value: unknown, depth: number): string {
	if (value !== null && typeof value === "object") {
		return renderObjectLiteral(value, depth);
	}

	if (typeof value === "string") {
		return JSON.stringify(value);
	}

	return String(value);
}

function renderObjectLiteral(value: object, depth: number): string {
	const entries = Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined);
	if (entries.length === 0) {
		return "{}";
	}

	const innerIndent = "\t".repeat(depth + 1);
	const closeIndent = "\t".repeat(depth);
	const lines = entries.map(([key, fieldValue]) => {
		const renderedKey = IDENTIFIER_PATTERN.test(key) ? key : JSON.stringify(key);
		return `${innerIndent}${renderedKey}: ${renderValue(fieldValue, depth + 1)}`;
	});
	return `{\n${lines.join(",\n")}\n${closeIndent}}`;
}
