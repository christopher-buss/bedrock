import type { Result } from "@bedrock-rbx/ocale";

import { dirname, join } from "node:path";

import { addLuaurcAlias, type LuaurcAliasError } from "../core/luaurc.ts";

/**
 * Alias name `bedrock setup` declares in the `.luaurc`, without the leading
 * `@`.
 */
export const BEDROCK_ALIAS = "bedrock";

const ALIAS_TARGET = ".bedrock/";
/** Where `setup` writes the Luau types, relative to the project root. */
export const TYPES_FILE = ".bedrock/config.luau";

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

/** Why {@link setupLuauTypesAsync} stopped. */
export type SetupLuauTypesError = LuaurcAliasError | SetupFileError;

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
 * A file `bedrock setup` could not read, or could not write (directory
 * creation included). A read fails before anything is written; a write may
 * follow earlier writes.
 */
interface SetupFileError {
	/** The value the filesystem seam rejected with. */
	readonly cause: unknown;
	/** Whether the read or the write failed. */
	readonly kind: "fileReadFailed" | "fileWriteFailed";
	/** Path of the file or directory that failed. */
	readonly path: string;
}

interface SetupPlan {
	readonly luaurc: { readonly changed: boolean; readonly content: string };
	readonly luaurcPath: string;
	readonly typesPath: string;
	readonly typesWritten: boolean;
}

interface WriteStep {
	readonly path: string;
	readonly run: () => Promise<void>;
}

/**
 * Write the bundled `@bedrock/config` Luau source to `.bedrock/config.luau`
 * and declare the `@bedrock` alias in the project's `.luaurc`, creating it
 * when absent. A file that already holds the wanted content is not written.
 * When the `.luaurc` cannot take the alias, or a file cannot be read,
 * nothing is written. A failed write stops at that file.
 *
 * @param deps - Filesystem seams, the project root, and the bundled source.
 * @returns What was written, or why setup stopped.
 */
export async function setupLuauTypesAsync(
	deps: SetupLuauTypesDeps,
): Promise<Result<SetupLuauTypesReport, SetupLuauTypesError>> {
	const plan = await planAsync(deps);
	if (!plan.success) {
		return plan;
	}

	const { luaurc, luaurcPath, typesPath, typesWritten } = plan.data;
	for (const write of planWrites(deps, plan.data)) {
		const written = await attemptAsync("fileWriteFailed", write);
		if (!written.success) {
			return written;
		}
	}

	return {
		data: { luaurcPath, luaurcWritten: luaurc.changed, typesPath, typesWritten },
		success: true,
	};
}

function planWrites(
	deps: SetupLuauTypesDeps,
	{ luaurc, luaurcPath, typesPath, typesWritten }: SetupPlan,
): Array<WriteStep> {
	return [
		...(typesWritten
			? [
					{ path: dirname(typesPath), run: async () => deps.mkdir(dirname(typesPath)) },
					{
						path: typesPath,
						run: async () => deps.writeFile(typesPath, deps.bundledSource),
					},
				]
			: []),
		...(luaurc.changed
			? [{ path: luaurcPath, run: async () => deps.writeFile(luaurcPath, luaurc.content) }]
			: []),
	];
}

async function attemptAsync<T>(
	kind: SetupFileError["kind"],
	step: { readonly path: string; readonly run: () => Promise<T> },
): Promise<Result<T, SetupFileError>> {
	try {
		return { data: await step.run(), success: true };
	} catch (err) {
		return { err: { cause: err, kind, path: step.path }, success: false };
	}
}

async function readAsync(
	deps: SetupLuauTypesDeps,
	path: string,
): Promise<Result<string | undefined, SetupFileError>> {
	return attemptAsync("fileReadFailed", {
		path,
		run: async () => deps.readOptionalTextFile(path),
	});
}

async function planAsync(
	deps: SetupLuauTypesDeps,
): Promise<Result<SetupPlan, SetupLuauTypesError>> {
	const luaurcPath = join(deps.projectRoot, LUAURC_FILE);
	const typesPath = join(deps.projectRoot, TYPES_FILE);

	const existingLuaurc = await readAsync(deps, luaurcPath);
	if (!existingLuaurc.success) {
		return existingLuaurc;
	}

	const luaurc = addLuaurcAlias(existingLuaurc.data, {
		alias: BEDROCK_ALIAS,
		target: ALIAS_TARGET,
	});
	if (!luaurc.success) {
		return luaurc;
	}

	const existingTypes = await readAsync(deps, typesPath);
	if (!existingTypes.success) {
		return existingTypes;
	}

	return {
		data: {
			luaurc: luaurc.data,
			luaurcPath,
			typesPath,
			typesWritten: existingTypes.data !== deps.bundledSource,
		},
		success: true,
	};
}
