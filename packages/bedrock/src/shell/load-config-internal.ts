export const LUAU_BOOTSTRAP_TEMP_PREFIX = "bedrock-luau-bootstrap-";

/**
 * Build the `mkdtempSync` prefix used for Luau bootstrap directories.
 *
 * Namespacing the temp directory by `process.pid` keeps parallel vitest
 * workers from observing each other's in-flight bootstrap dirs through the
 * shared `tmpdir()`, which would otherwise race the cleanup test's readdir
 * snapshot.
 * @param pid - Process id to embed in the prefix; pass `process.pid` from
 * production callers.
 * @returns The full prefix to pass to `mkdtempSync`, including the trailing
 * separator that `mkdtempSync` appends its random suffix to.
 */
export function bootstrapDirectoryPrefix(pid: number): string {
	return `${LUAU_BOOTSTRAP_TEMP_PREFIX}${pid}-`;
}
