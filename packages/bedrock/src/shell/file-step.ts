import type { Result } from "@bedrock-rbx/ocale";

/**
 * A file that could not be read, or could not be written (directory creation
 * included).
 *
 * @template K - Which step failed.
 */
export interface FileStepError<K extends FileStepKind = FileStepKind> {
	/** The value the filesystem seam rejected with. */
	readonly cause: unknown;
	/** Whether the read or the write failed. */
	readonly kind: K;
	/** Path of the file or directory that failed. */
	readonly path: string;
}

/** Which filesystem step failed. */
type FileStepKind = "fileReadFailed" | "fileWriteFailed";

/**
 * Run one filesystem step, turning a rejection into a {@link FileStepError}
 * naming the step's path.
 *
 * @template T - What the step resolves with.
 * @template K - Which step this is.
 * @param kind - The error kind to report on rejection.
 * @param step - The path the step touches and the step itself.
 * @returns The step's value, or the failure.
 */
export async function attemptFileStepAsync<T, K extends FileStepKind>(
	kind: K,
	step: { readonly path: string; readonly run: () => Promise<T> },
): Promise<Result<T, FileStepError<K>>> {
	try {
		return { data: await step.run(), success: true };
	} catch (err) {
		return { err: { cause: err, kind, path: step.path }, success: false };
	}
}

/**
 * Read an optional UTF-8 text file, turning a rejection into a
 * `fileReadFailed` error naming the path.
 *
 * @param read - Reads a UTF-8 text file, resolving `undefined` when absent.
 * @param path - Where the file lives.
 * @returns The contents, `undefined` when absent, or the read failure.
 */
export async function readOptionalFileStepAsync(
	read: (path: string) => Promise<string | undefined>,
	path: string,
): Promise<Result<string | undefined, FileStepError<"fileReadFailed">>> {
	return attemptFileStepAsync("fileReadFailed", { path, run: async () => read(path) });
}
