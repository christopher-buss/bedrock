import { mkdir, writeFile } from "node:fs/promises";

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
