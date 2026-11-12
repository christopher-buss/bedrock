import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Create a directory, parents included. The default behind the CLI's
 * `mkdir` dependency slot.
 *
 * @param path - Directory to create.
 */
export async function nodeMkdirAsync(path: string): Promise<void> {
	await mkdir(path, { recursive: true });
}

/**
 * Write a UTF-8 text file. The default behind the CLI's `writeFile`
 * dependency slot.
 *
 * @param path - File to write.
 * @param contents - Text to write.
 */
export async function nodeWriteTextFileAsync(path: string, contents: string): Promise<void> {
	await writeFile(path, contents, "utf8");
}

/**
 * Write text or bytes, creating the parent directories first. The default
 * behind the import command's writes of config text and icon files.
 *
 * @param path - File to write.
 * @param contents - Text, written as UTF-8, or bytes.
 */
export async function nodeWriteFileAsync(
	path: string,
	contents: string | Uint8Array,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, contents);
}

/**
 * Read a UTF-8 text file. The default behind the CLI's `readTextFile`
 * dependency slot.
 *
 * @param path - File to read.
 * @returns The file's contents.
 * @rejects When the file cannot be read.
 */
export async function nodeReadTextFileAsync(path: string): Promise<string> {
	return readFile(path, "utf8");
}

/**
 * Read a UTF-8 text file that may not exist. The default behind the CLI's
 * `readOptionalTextFile` dependency slot.
 *
 * @param path - File to read.
 * @returns The file's contents, or `undefined` when there is no such file.
 * @rejects When the file exists but cannot be read.
 */
export async function nodeReadOptionalTextFileAsync(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch (err) {
		if (Reflect.get(Object(err), "code") === "ENOENT") {
			return undefined;
		}

		throw err;
	}
}

/**
 * Move a file onto another path, replacing what is there. The default
 * behind the CLI's `rename` dependency slot.
 *
 * @param from - File to move.
 * @param to - Path to move it to.
 */
export async function nodeRenameFileAsync(from: string, to: string): Promise<void> {
	await rename(from, to);
}

/**
 * Delete a file, treating an already-absent one as done. The default
 * behind the CLI's `removeFile` dependency slot.
 *
 * @param path - File to delete.
 */
export async function nodeRemoveFileAsync(path: string): Promise<void> {
	await rm(path, { force: true });
}
