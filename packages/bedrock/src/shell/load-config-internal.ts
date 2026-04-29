const LUAU_BOOTSTRAP_TEMP_PREFIX = "bedrock-luau-bootstrap-";

/**
 * Build the `mkdtempSync` prefix used for Luau bootstrap directories.
 *
 * Embedding `process.pid` scopes the directory to its creator. Concurrent
 * processes share `tmpdir()`, so without a pid component they would observe
 * each other's in-flight bootstrap dirs whenever any caller scans the temp
 * directory.
 * @param pid - Process id to embed in the prefix; pass `process.pid` from
 * production callers.
 * @returns The full prefix to pass to `mkdtempSync`, including the trailing
 * separator that `mkdtempSync` appends its random suffix to.
 */
export function bootstrapDirectoryPrefix(pid: number): string {
	return `${LUAU_BOOTSTRAP_TEMP_PREFIX}${pid}-`;
}
