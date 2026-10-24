import type { Result } from "@bedrock-rbx/ocale";

import { dirname, join } from "node:path";

import { addLuaurcAlias, type LuaurcAliasError } from "../core/luaurc.ts";

const ALIAS = "bedrock";
const ALIAS_TARGET = ".bedrock/";
const TYPES_FILE = ".bedrock/config.luau";
const LUAURC_FILE = ".luaurc";

/** Filesystem seams and inputs for {@link setupLuauTypesAsync}. */
export interface SetupLuauTypesDeps {
	/** The `@bedrock/config` Luau source this bedrock version ships. */
	readonly bundledSource: string;
	/** Creates a directory, parents included. */
	readonly mkdir: (path: string) => Promise<void>;
	/** Directory holding the project's `.luaurc`. */
	readonly projectRoot: string;
	/** Reads a UTF-8 text file, resolving `undefined` when it is absent. */
	readonly readOptionalTextFile: (path: string) => Promise<string | undefined>;
	/** Writes a UTF-8 text file. */
	readonly writeFile: (path: string, contents: string) => Promise<void>;
}

/** What {@link setupLuauTypesAsync} found and wrote. */
export interface SetupLuauTypesReport {
	/** Path of the project's `.luaurc`. */
	readonly luaurcPath: string;
	/** Whether the `.luaurc` was written. */
	readonly luaurcWritten: boolean;
	/** Path of the Luau types file. */
	readonly typesPath: string;
	/** Whether the Luau types file was written. */
	readonly typesWritten: boolean;
}

/**
 * Write the bundled `@bedrock/config` Luau source to `.bedrock/config.luau`
 * and declare the `@bedrock` alias in the project's `.luaurc`, creating it
 * when absent. A file that already holds the wanted content is not written.
 * When the `.luaurc` cannot take the alias, nothing is written.
 *
 * @param deps - Filesystem seams, the project root, and the bundled source.
 * @returns What was written, or why the alias could not be added.
 */
export async function setupLuauTypesAsync(
	deps: SetupLuauTypesDeps,
): Promise<Result<SetupLuauTypesReport, LuaurcAliasError>> {
	const luaurcPath = join(deps.projectRoot, LUAURC_FILE);
	const typesPath = join(deps.projectRoot, TYPES_FILE);

	const luaurc = addLuaurcAlias(await deps.readOptionalTextFile(luaurcPath), {
		alias: ALIAS,
		target: ALIAS_TARGET,
	});
	if (!luaurc.success) {
		return luaurc;
	}

	const typesWritten = (await deps.readOptionalTextFile(typesPath)) !== deps.bundledSource;
	if (typesWritten) {
		await deps.mkdir(dirname(typesPath));
		await deps.writeFile(typesPath, deps.bundledSource);
	}

	if (luaurc.data.changed) {
		await deps.writeFile(luaurcPath, luaurc.data.content);
	}

	return {
		data: { luaurcPath, luaurcWritten: luaurc.data.changed, typesPath, typesWritten },
		success: true,
	};
}
