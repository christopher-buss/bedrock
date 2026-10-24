import type { Result } from "@bedrock-rbx/ocale";

import { join } from "node:path";

import { type FileStepError, readOptionalFileStepAsync } from "./file-step.ts";

/** Read-only seams and inputs for {@link checkLuauTypesStaleAsync}. */
export interface CheckLuauTypesStaleDeps {
	/** The `@bedrock/config` Luau source this bedrock version ships. */
	readonly bundledSource: string;
	/** Directory `setup` wrote the Luau types under. */
	readonly projectRoot: string;
	/** Reads a UTF-8 text file, resolving `undefined` when it is absent. */
	readonly readOptionalTextFile: (path: string) => Promise<string | undefined>;
	/** Path of the Luau types file, relative to the project root. */
	readonly typesFile: string;
}

/** What {@link checkLuauTypesStaleAsync} found. */
export interface LuauTypesStaleness {
	/** How the on-disk types compare with the shipped source. */
	readonly status: LuauTypesStatus;
	/** Path of the Luau types file. */
	readonly typesPath: string;
}

/**
 * How the on-disk Luau types compare with the shipped source: `fresh` when
 * identical, `stale` when any byte differs, `missing` when `setup` has not
 * written them.
 */
type LuauTypesStatus = "fresh" | "missing" | "stale";

/**
 * Compare the Luau types `setup` wrote to `deps.typesFile` with the
 * source this bedrock version ships. Reads only; never writes.
 *
 * @param deps - The read seam, the project root, the types file, and the
 *   bundled source.
 * @returns Whether the on-disk types are fresh, stale, or missing, or the
 *   read failure when the types file exists but cannot be read.
 */
export async function checkLuauTypesStaleAsync(
	deps: CheckLuauTypesStaleDeps,
): Promise<Result<LuauTypesStaleness, FileStepError<"fileReadFailed">>> {
	const typesPath = join(deps.projectRoot, deps.typesFile);
	const read = await readOptionalFileStepAsync(deps.readOptionalTextFile, typesPath);
	if (!read.success) {
		return read;
	}

	const onDisk = read.data;
	if (onDisk === undefined) {
		return { data: { status: "missing", typesPath }, success: true };
	}

	return {
		data: { status: onDisk === deps.bundledSource ? "fresh" : "stale", typesPath },
		success: true,
	};
}
