import type { Result } from "@bedrock-rbx/ocale";

import type { LuauAlias } from "../core/luau-config-alias.ts";

/** What a `ConfigLuauEditor` read from a `.config.luau`. */
export interface ConfigLuauInspection {
	/**
	 * The `luau.aliases` entries, by name: the target for a string literal,
	 * `false` for any other value.
	 */
	readonly aliases: Readonly<Record<string, false | string>>;
	/**
	 * The source with the alias set to the target, or the source as read
	 * when the alias holds a value that is not a string literal.
	 */
	readonly edited: string;
}

/**
 * Failure surfaced by a `ConfigLuauEditor`. Narrow on `kind`.
 *
 * - `uneditableConfigLuau`: the source does not parse, does not return a
 *   table literal, or holds `luau` or `luau.aliases` as something other
 *   than a table literal, or the runtime is too old to read its syntax tree.
 * - `missingRuntime`: the Luau runtime binary could not be found.
 * - `editorFailed`: the runtime ran but its output could not be read.
 */
export type ConfigLuauEditorError =
	| { readonly hint: string; readonly kind: "missingRuntime" }
	| { readonly kind: "editorFailed"; readonly message: string }
	| { readonly kind: "uneditableConfigLuau"; readonly reason: string };

/**
 * Driven port that reads the aliases of a `.config.luau` source and
 * produces the source with one alias set, keeping all other text as
 * written. The default adapter (`createLuteConfigLuauEditor`) runs the
 * `lute` runtime.
 */
export type ConfigLuauEditor = (
	source: string,
	wanted: Pick<LuauAlias, "alias" | "target">,
) => Promise<Result<ConfigLuauInspection, ConfigLuauEditorError>>;
