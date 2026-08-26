import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

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
 * Delete a file, treating an already-absent one as done. The default
 * behind the CLI's `removeFile` dependency slot.
 *
 * @param path - File to delete.
 */
export async function nodeRemoveFileAsync(path: string): Promise<void> {
	await rm(path, { force: true });
}
