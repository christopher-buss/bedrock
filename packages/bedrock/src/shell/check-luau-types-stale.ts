import { join } from "node:path";

import { TYPES_FILE } from "./setup-luau-types.ts";

/** Read-only seams and inputs for {@link checkLuauTypesStaleAsync}. */
export interface CheckLuauTypesStaleDeps {
	/** The `@bedrock/config` Luau source this bedrock version ships. */
	readonly bundledSource: string;
	/** Directory `setup` wrote the Luau types under. */
	readonly projectRoot: string;
	/** Reads a UTF-8 text file, resolving `undefined` when it is absent. */
	readonly readOptionalTextFile: (path: string) => Promise<string | undefined>;
}

/**
 * How the on-disk Luau types compare with the shipped source: `fresh` when
 * identical, `stale` when any byte differs, `missing` when `setup` has not
 * written them.
 */
export type LuauTypesStatus = "fresh" | "missing" | "stale";

/** What {@link checkLuauTypesStaleAsync} found. */
export interface LuauTypesStaleness {
	/** How the on-disk types compare with the shipped source. */
	readonly status: LuauTypesStatus;
	/** Path of the Luau types file. */
	readonly typesPath: string;
}

/**
 * Compare the Luau types `setup` wrote to `.bedrock/config.luau` with the
 * source this bedrock version ships. Reads only; never writes.
 *
 * @param deps - The read seam, the project root, and the bundled source.
 * @returns Whether the on-disk types are fresh, stale, or missing.
 * @rejects When the types file exists but cannot be read.
 */
export async function checkLuauTypesStaleAsync(
	deps: CheckLuauTypesStaleDeps,
): Promise<LuauTypesStaleness> {
	const typesPath = join(deps.projectRoot, TYPES_FILE);
	const onDisk = await deps.readOptionalTextFile(typesPath);
	if (onDisk === undefined) {
		return { status: "missing", typesPath };
	}

	return { status: onDisk === deps.bundledSource ? "fresh" : "stale", typesPath };
}
