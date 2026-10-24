import type { Result } from "@bedrock-rbx/ocale";

import { isRecord } from "./is-record.ts";
import { parseJsonObject } from "./parse-json-object.ts";

/** An alias to declare in a `.luaurc`. */
export interface LuaurcAlias {
	/** Alias name, without the leading `@`. */
	readonly alias: string;
	/** A previous target the alias may still hold, which is overwritten. */
	readonly replaces?: string | undefined;
	/** Path the alias resolves to, relative to the `.luaurc`. */
	readonly target: string;
}

/** The `.luaurc` content after an alias was merged in. */
export interface LuaurcAliasOutcome {
	/** Whether `content` differs from what was read. */
	readonly changed: boolean;
	/** The `.luaurc` text to write. */
	readonly content: string;
}

/** Why an alias could not be merged into a `.luaurc`. */
export type LuaurcAliasError =
	| {
			/** The alias that is already declared. */
			readonly alias: string;
			/** The path the existing alias points at. */
			readonly existingTarget: string;
			readonly kind: "aliasConflict";
	  }
	| {
			readonly kind: "malformedLuaurc";
			/** What is wrong with the content. */
			readonly message: string;
	  };

interface ParsedLuaurc {
	readonly aliases: Record<string, unknown>;
	readonly root: Record<string, unknown>;
}

/**
 * Merge `alias` → `target` into the `aliases` table of a `.luaurc`, keeping
 * every other alias and key. Content that already maps the alias to `target`,
 * ignoring a leading `./` and trailing `/`, is returned as read, so a rerun
 * writes nothing new. An alias that holds `replaces` is pointed at `target`.
 *
 * @param content - The current `.luaurc` text, or `undefined` when the file
 *   is absent. Blank text is treated as absent.
 * @param wanted - The alias to declare and the path it points at.
 * @returns The content to write, or why the alias cannot be added.
 */
export function addLuaurcAlias(
	content: string | undefined,
	{ alias, replaces, target }: LuaurcAlias,
): Result<LuaurcAliasOutcome, LuaurcAliasError> {
	const text = content ?? "";
	const parsed = parseLuaurc(text);
	if (!parsed.success) {
		return parsed;
	}

	const { aliases, root } = parsed.data;
	const existing = aliases[alias];
	if (typeof existing === "string" && normalizeTarget(existing) === normalizeTarget(target)) {
		return { data: { changed: false, content: text }, success: true };
	}

	const replaceable =
		typeof existing === "string" &&
		replaces !== undefined &&
		normalizeTarget(existing) === normalizeTarget(replaces);
	if (existing !== undefined && !replaceable) {
		if (typeof existing !== "string") {
			return malformed(`its "${alias}" alias does not point at a string path`);
		}

		return { err: { alias, existingTarget: existing, kind: "aliasConflict" }, success: false };
	}

	const merged = { ...root, aliases: { ...aliases, [alias]: target } };
	return {
		data: { changed: true, content: `${JSON.stringify(merged, undefined, "\t")}\n` },
		success: true,
	};
}

function malformed(message: string): Result<never, LuaurcAliasError> {
	return { err: { kind: "malformedLuaurc", message }, success: false };
}

function trimTrailingSlashes(path: string): string {
	return path.endsWith("/") ? trimTrailingSlashes(path.slice(0, -1)) : path;
}

function normalizeTarget(target: string): string {
	return trimTrailingSlashes(target.startsWith("./") ? target.slice(2) : target);
}

function parseLuaurc(content: string): Result<ParsedLuaurc, LuaurcAliasError> {
	if (content.trim() === "") {
		return { data: { aliases: {}, root: {} }, success: true };
	}

	const parsed = parseJsonObject(content);
	if (!parsed.success) {
		return malformed(parsed.err);
	}

	const root = parsed.data;
	const aliases = root["aliases"] ?? {};
	if (!isRecord(aliases)) {
		return malformed('its "aliases" entry is not a JSON object');
	}

	return { data: { aliases, root }, success: true };
}
