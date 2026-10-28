import type { Result } from "@bedrock-rbx/ocale";

/** Which Luau config files exist in a project root. */
export interface LuauConfigPresence {
	/** Whether `.config.luau` exists. */
	readonly configLuauExists: boolean;
	/** Whether `.luaurc` exists. */
	readonly luaurcExists: boolean;
}

/** An alias to declare in a Luau config file. */
export interface LuauAlias {
	/** Alias name, without the leading `@`. */
	readonly alias: string;
	/** A previous target the alias may still hold, which is overwritten. */
	readonly replaces?: string | undefined;
	/** Path the alias resolves to, relative to the config file. */
	readonly target: string;
}

/**
 * What to do with a declared alias: `unchanged` when it already points at
 * the target, `set` when it is absent or holds the target it replaces.
 */
export type LuauAliasDecision = "set" | "unchanged";

/** Why an alias cannot be declared. */
export type LuauAliasError =
	| {
			/** The alias that is already declared. */
			readonly alias: string;
			/** The path the existing alias points at. */
			readonly existingTarget: string;
			readonly kind: "aliasConflict";
	  }
	| {
			/** The alias whose value is not a string path. */
			readonly alias: string;
			readonly kind: "aliasNotString";
	  };

const IDENTIFIER = /^[a-z_]\w*$/i;

const LUAU_KEYWORDS = new Set([
	"and",
	"break",
	"do",
	"else",
	"elseif",
	"end",
	"false",
	"for",
	"function",
	"if",
	"in",
	"local",
	"nil",
	"not",
	"or",
	"repeat",
	"return",
	"then",
	"true",
	"until",
	"while",
]);

/**
 * Whether a project root holds both `.luaurc` and `.config.luau`. Both files
 * present is an error.
 *
 * @param presence - Which config files exist.
 * @returns `true` when both files exist.
 */
export function hasConflictingLuauConfigs({
	configLuauExists,
	luaurcExists,
}: LuauConfigPresence): boolean {
	return configLuauExists && luaurcExists;
}

/**
 * Decide whether `aliases` must change to map `alias` to `target`. Targets
 * compare ignoring a leading `./` and trailing `/`.
 *
 * @param aliases - The declared aliases, by name.
 * @param wanted - The alias, its target, and a previous target it may hold.
 * @returns Whether to set the alias, or why it cannot be declared.
 */
export function decideLuauAlias(
	aliases: Readonly<Record<string, unknown>>,
	{ alias, replaces, target }: LuauAlias,
): Result<LuauAliasDecision, LuauAliasError> {
	const existing = aliases[alias];
	if (existing === undefined) {
		return { data: "set", success: true };
	}

	if (typeof existing !== "string") {
		return { err: { alias, kind: "aliasNotString" }, success: false };
	}

	if (normalizeTarget(existing) === normalizeTarget(target)) {
		return { data: "unchanged", success: true };
	}

	if (replaces !== undefined && normalizeTarget(existing) === normalizeTarget(replaces)) {
		return { data: "set", success: true };
	}

	return { err: { alias, existingTarget: existing, kind: "aliasConflict" }, success: false };
}

/**
 * The `.config.luau` entry to add by hand when setup cannot edit the file.
 *
 * @param wanted - The alias and its target.
 * @returns The `luau` entry, nesting the alias under `aliases`.
 */
export function configLuauAliasSnippet({ alias, target }: LuauAlias): string {
	const key =
		IDENTIFIER.test(alias) && !LUAU_KEYWORDS.has(alias) ? alias : `[${JSON.stringify(alias)}]`;
	return `luau = {\n\taliases = {\n\t\t${key} = ${JSON.stringify(target)},\n\t},\n},`;
}

function trimTrailingSlashes(path: string): string {
	return path.endsWith("/") ? trimTrailingSlashes(path.slice(0, -1)) : path;
}

function normalizeTarget(target: string): string {
	return trimTrailingSlashes(target.startsWith("./") ? target.slice(2) : target);
}
