/**
 * Compute which gist filenames should be removed so that at most `keep`
 * prefix-matching files remain. Filenames are compared lexicographically,
 * which orders Date.now()-style timestamps oldest-first. Non-matching
 * filenames are ignored entirely.
 * @param filenames - Every filename currently present in the gist.
 * @param prefix - Only filenames starting with this string participate in the
 * retention window; others are left alone.
 * @param keep - How many of the newest matching filenames to retain.
 * @returns The matching filenames that should be deleted, oldest-first.
 */
export function selectFilesToDelete(
	filenames: ReadonlyArray<string>,
	prefix: string,
	keep: number,
): ReadonlyArray<string> {
	const sorted = filenames.filter((name) => name.startsWith(prefix)).sort();
	const excess = sorted.length - keep;
	return excess <= 0 ? [] : sorted.slice(0, excess);
}
