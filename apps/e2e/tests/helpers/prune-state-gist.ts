/**
 * Options controlling a smoke-test gist prune call.
 */
export interface PruneStateGistOptions {
	/** Filename prefix (e.g. `state.cli-smoke-`) that scopes the prune. */
	readonly filenamePrefix: string;
	/** Identifier of the gist holding smoke-test state files. */
	readonly gistId: string;
	/** Number of newest matching files to retain. */
	readonly keep: number;
	/** GitHub token with write access to the gist. */
	readonly token: string;
}

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

/**
 * Best-effort prune of a smoke-test gist down to the newest `keep` files for
 * a given filename prefix. Failures are logged via `console.warn` and
 * swallowed so that a transient gist API hiccup does not flip an otherwise-
 * passing smoke test to failed; the next run's prune will retry the cleanup.
 * @param options - Prune target, retention count, and credentials.
 */
export async function pruneStateGist(options: PruneStateGistOptions): Promise<void> {
	const { filenamePrefix, gistId, keep, token } = options;
	const url = `https://api.github.com/gists/${gistId}`;
	const headers = gistHeaders(token);

	try {
		const filenames = await listGistFilenames(url, headers);
		const toDelete = selectFilesToDelete(filenames, filenamePrefix, keep);
		if (toDelete.length === 0) {
			return;
		}

		await deleteGistFiles(url, headers, toDelete);
	} catch (err) {
		console.warn(`pruneStateGist: ${String(err)}`);
	}
}

function gistHeaders(token: string): Record<string, string> {
	return {
		"Accept": "application/vnd.github+json",
		"Authorization": `Bearer ${token}`,
		"User-Agent": "bedrock",
		"X-GitHub-Api-Version": "2026-03-10",
	};
}

/**
 * GET the gist and return the filenames currently stored in it. Returns an
 * empty list when the request fails or the response shape is unexpected.
 * @param url - The full gist URL (including ID).
 * @param headers - Authenticated request headers from {@link gistHeaders}.
 * @returns Filenames present in the gist, or `[]` on error.
 */
async function listGistFilenames(
	url: string,
	headers: Record<string, string>,
): Promise<ReadonlyArray<string>> {
	const response = await fetch(url, { headers });
	if (!response.ok) {
		console.warn(`pruneStateGist: list failed with status ${String(response.status)}`);
		return [];
	}

	const body: unknown = await response.json();
	if (
		typeof body === "object" &&
		body !== null &&
		"files" in body &&
		typeof body.files === "object" &&
		body.files !== null
	) {
		return Object.keys(body.files);
	}

	return [];
}

/**
 * PATCH the gist to delete every named file in a single request.
 * @param url - The full gist URL (including ID).
 * @param headers - Authenticated request headers from {@link gistHeaders}.
 * @param names - Filenames to delete; must be non-empty.
 */
async function deleteGistFiles(
	url: string,
	headers: Record<string, string>,
	names: ReadonlyArray<string>,
): Promise<void> {
	const filesPayload = Object.fromEntries(names.map((name): [string, null] => [name, null]));
	const response = await fetch(url, {
		body: JSON.stringify({ files: filesPayload }),
		headers: { ...headers, "Content-Type": "application/json" },
		method: "PATCH",
	});
	if (!response.ok) {
		console.warn(`pruneStateGist: prune failed with status ${String(response.status)}`);
	}
}
