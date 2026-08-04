import { ArkErrors, type } from "arktype";

const gistResponse = type({
	files: {
		"[string]": "unknown",
	},
});

const MAX_RETRIES = 3;
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([409, 502, 503, 504]);

/**
 * Options controlling a smoke-test gist prune call.
 */
export interface PruneStateGistOptions {
	/** Injection seam for tests; defaults to `globalThis.fetch`. */
	readonly fetch?: Fetch | undefined;
	/** Filename prefix (e.g. `state.cli-smoke-`) that scopes the prune. */
	readonly filenamePrefix: string;
	/** Identifier of the gist holding smoke-test state files. */
	readonly gistId: string;
	/** Number of newest matching files to retain. */
	readonly keep: number;
	/**
	 * Injection seam for retry backoff timing; defaults to a `setTimeout`-based
	 * promise. Tests pass a fake to keep retry assertions deterministic.
	 */
	readonly sleep?: ((ms: number) => Promise<void>) | undefined;
	/** GitHub token with write access to the gist. */
	readonly token: string;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

interface PruneRequestContext {
	readonly fetchFn: Fetch;
	readonly headers: Record<string, string>;
	readonly sleep: (ms: number) => Promise<void>;
	readonly url: string;
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
export async function pruneStateGistAsync({
	fetch: fetchFunc = fetch.bind(globalThis),
	filenamePrefix,
	gistId,
	keep,
	sleep = defaultSleepAsync,
	token,
}: PruneStateGistOptions): Promise<void> {
	const ctx: PruneRequestContext = {
		fetchFn: fetchFunc,
		headers: gistHeaders(token),
		sleep,
		url: `https://api.github.com/gists/${gistId}`,
	};

	try {
		const filenames = await listGistFilenamesAsync(ctx);
		const toDelete = selectFilesToDelete(filenames, filenamePrefix, keep);
		if (toDelete.length === 0) {
			return;
		}

		await deleteGistFilesAsync(ctx, toDelete);
	} catch (err) {
		console.warn(`pruneStateGist: ${String(err)}`);
	}
}

async function defaultSleepAsync(ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});
}

function gistHeaders(token: string): Record<string, string> {
	return {
		"Accept": "application/vnd.github+json",
		"Authorization": `Bearer ${token}`,
		"User-Agent": "bedrock",
		"X-GitHub-Api-Version": "2026-03-10",
	};
}

function isRetryableStatus(status: number): boolean {
	return RETRYABLE_STATUSES.has(status);
}

function backoffMs(attempt: number): number {
	return 1000 * 2 ** attempt;
}

async function withRetryAsync(
	sleep: (ms: number) => Promise<void>,
	operation: () => Promise<Response>,
): Promise<Response> {
	let response = await operation();
	for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
		if (response.ok || !isRetryableStatus(response.status)) {
			return response;
		}

		await sleep(backoffMs(attempt));
		response = await operation();
	}

	return response;
}

async function listGistFilenamesAsync(ctx: PruneRequestContext): Promise<ReadonlyArray<string>> {
	async function sendListAsync(): Promise<Response> {
		return ctx.fetchFn(ctx.url, { headers: ctx.headers });
	}

	const response = await withRetryAsync(ctx.sleep, sendListAsync);
	if (!response.ok) {
		// Return [] rather than throwing so a transient gist hiccup cannot flip
		// an otherwise-passing smoke test to failed.
		console.warn(`pruneStateGist: list failed with status ${String(response.status)}`);
		return [];
	}

	// `Response.json()` is typed `any` by the DOM lib, so the boundary is
	// declared `unknown` and narrowed by the arktype parse below.
	const body: unknown = await response.json();
	const parsed = gistResponse(body);
	if (parsed instanceof ArkErrors) {
		return [];
	}

	return Object.keys(parsed.files);
}

async function deleteGistFilesAsync(
	ctx: PruneRequestContext,
	names: ReadonlyArray<string>,
): Promise<void> {
	const filesPayload = Object.fromEntries(names.map((name): [string, null] => [name, null]));
	const body = JSON.stringify({ files: filesPayload });
	const headers = { ...ctx.headers, "Content-Type": "application/json" };
	async function sendDeleteAsync(): Promise<Response> {
		return ctx.fetchFn(ctx.url, { body, headers, method: "PATCH" });
	}

	const response = await withRetryAsync(ctx.sleep, sendDeleteAsync);
	if (!response.ok) {
		console.warn(`pruneStateGist: prune failed with status ${String(response.status)}`);
	}
}
