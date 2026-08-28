import type { Result } from "@bedrock-rbx/ocale";

import { validateEnvironmentName } from "../core/environment.ts";
import { isRecord } from "../core/is-record.ts";
import { parseStateFile, serializeStateFile } from "../core/state-file.ts";
import type { BedrockState, StateError, StateRecord } from "../core/state.ts";
import type { StatePort } from "../ports/state-port.ts";
import {
	errorBodyDetailAsync,
	type HttpFailure,
	mapHttpErrorAsync,
	networkError,
} from "./gist-http-errors.ts";
import { type RetryDependencies, withRetryAsync } from "./gist-retry.ts";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";
const USER_AGENT = "bedrock";
const MAX_INLINE_BYTES = 10_000_000;
const MAX_VISIBILITY_ATTEMPTS = 5;
const VISIBILITY_BASE_DELAY_MS = 250;

/**
 * Minimal `fetch`-compatible signature the adapter needs, narrower than
 * `typeof globalThis.fetch` so test fakes do not have to stub runtime
 * extensions such as `fetch.preconnect`.
 *
 * @since 0.2.2
 */
export type GistFetch = (
	input: globalThis.Request | string | URL,
	init?: RequestInit,
) => Promise<Response>;

/**
 * Configuration for {@link createGistStateAdapter}.
 *
 * @since 0.1.0
 */
export interface GistStateAdapterDeps {
	/** Injection seam for tests; defaults to `globalThis.fetch`. */
	readonly fetch?: GistFetch | undefined;
	/** ID of an existing GitHub Gist that holds this project's state files. */
	readonly gistId: string;
	/**
	 * Injection seam for retry jitter; defaults to `Math.random`. Tests pass a
	 * deterministic source so jittered sleep durations stay stable across runs.
	 * Jitter prevents concurrent callers (parallel CI jobs writing to the same
	 * gist) from retrying in lockstep and re-colliding on each backoff.
	 */
	readonly random?: (() => number) | undefined;
	/**
	 * Injection seam for retry backoff timing; defaults to a `setTimeout`-based
	 * promise. Tests pass a fake to keep retry assertions deterministic.
	 */
	readonly sleep?: ((ms: number) => Promise<void>) | undefined;
	/**
	 * GitHub token (fine-grained PAT or classic PAT) with gist read/write
	 * scope.
	 */
	readonly token: string;
}

interface AdapterContext {
	readonly fetchFn: GistFetch;
	readonly gistId: string;
	readonly random: () => number;
	readonly sleep: (ms: number) => Promise<void>;
	readonly token: string;
}

interface GistFile {
	readonly content: string | undefined;
	readonly isTruncated: boolean;
	readonly rawUrl: string | undefined;
	readonly size: number;
}

interface ReadContentParameters {
	readonly entry: GistFile;
	readonly fetchFn: GistFetch;
	readonly file: string;
	readonly retry: RetryDependencies;
}

interface VisibilityTarget {
	readonly content: string;
	readonly environment: string;
}

/**
 * Build a `StatePort` that persists Bedrock state in a GitHub Gist.
 *
 * One gist holds one file per environment, named `state.<env>.json`. The
 * adapter authenticates with a user-supplied token and speaks the GitHub
 * REST API directly; no SDK dependency.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import { createGistStateAdapter } from "@bedrock-rbx/core";
 *
 * const port = createGistStateAdapter({
 *     fetch: async () =>
 *         new Response(JSON.stringify({ files: {} }), { status: 200 }),
 *     gistId: "abc123def456",
 *     token: "ghp_example",
 * });
 *
 * return port.read("production").then((result) => {
 *     expect(result.success).toBeTrue();
 *     if (result.success) {
 *         expect(result.data.state).toBeUndefined();
 *     }
 * });
 * ```
 *
 * @param deps - Gist ID, GitHub token, and optional fetch override.
 * @returns A `StatePort` ready to be passed to `deploy()`.
 */
export function createGistStateAdapter(deps: GistStateAdapterDeps): StatePort {
	const ctx: AdapterContext = {
		fetchFn: deps.fetch ?? fetch.bind(globalThis),
		gistId: deps.gistId,
		random: deps.random ?? Math.random,
		sleep: deps.sleep ?? defaultSleepAsync,
		token: deps.token,
	};

	return {
		async read(environment) {
			const safe = validateEnvironmentName(environment);
			if (!safe.success) {
				return safe;
			}

			return readPathAsync(ctx, safe.data);
		},
		async write(state) {
			const safe = validateEnvironmentName(state.environment);
			if (!safe.success) {
				return safe;
			}

			return writePathAsync(ctx, state);
		},
	};
}

async function defaultSleepAsync(ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});
}

function fileLabel(gistId: string, environment: string): string {
	return `gist:${gistId}/state.${environment}.json`;
}

function fileName(environment: string): string {
	return `state.${environment}.json`;
}

function toGistFile(files: unknown, name: string): GistFile | undefined {
	if (!isRecord(files)) {
		return undefined;
	}

	const record = files[name];
	if (!isRecord(record)) {
		return undefined;
	}

	const content = typeof record["content"] === "string" ? record["content"] : undefined;
	const rawUrl = typeof record["raw_url"] === "string" ? record["raw_url"] : undefined;
	const size = typeof record["size"] === "number" ? record["size"] : 0;
	const isTruncated = record["truncated"] === true;
	return { content, isTruncated, rawUrl, size };
}

function buildHeaders(token: string): Headers {
	const headers = new Headers();
	headers.set("Accept", "application/vnd.github+json");
	headers.set("Authorization", `Bearer ${token}`);
	headers.set("User-Agent", USER_AGENT);
	headers.set("X-GitHub-Api-Version", GITHUB_API_VERSION);
	return headers;
}

async function sendGetAsync(ctx: AdapterContext, etag?: string): Promise<Response> {
	const headers = buildHeaders(ctx.token);
	if (etag !== undefined) {
		// Conditional GET: a replica still serving the prior body answers 304,
		// which GitHub does not count against the primary REST rate limit.
		headers.set("If-None-Match", etag);
	}

	return ctx.fetchFn(`${GITHUB_API_BASE}/gists/${ctx.gistId}`, {
		headers,
		method: "GET",
	});
}

function stateErr<T>(file: string, reason: string): Result<T, StateError> {
	return { err: { file, kind: "stateError", reason }, success: false };
}

async function fetchGistBodyAsync(
	ctx: AdapterContext,
	file: string,
): Promise<Result<Record<string, unknown>, StateError>> {
	let response: Response;
	try {
		response = await withRetryAsync(ctx, async () => sendGetAsync(ctx));
	} catch (err) {
		return { err: networkError(err, file), success: false };
	}

	if (!response.ok) {
		return {
			err: await mapHttpErrorAsync({ file, gistId: ctx.gistId, response }),
			success: false,
		};
	}

	// `Response.json()` is typed `any` by the DOM lib, so the boundary is
	// declared `unknown` and narrowed by the guard below.
	const body: unknown = await response.json();
	if (!isRecord(body)) {
		return stateErr(file, "gist response body was not a JSON object");
	}

	return { data: body, success: true };
}

async function readGistContentAsync({
	entry,
	fetchFn,
	file,
	retry,
}: ReadContentParameters): Promise<Result<BedrockState | undefined, StateError>> {
	if (entry.size > MAX_INLINE_BYTES) {
		return stateErr(file, `state file too large: ${entry.size} bytes`);
	}

	if (entry.isTruncated) {
		if (entry.rawUrl === undefined) {
			return stateErr(file, "truncated gist file missing raw_url");
		}

		const { rawUrl } = entry;
		let rawResponse: Response;
		try {
			rawResponse = await withRetryAsync(retry, async () => fetchFn(rawUrl));
		} catch (err) {
			return { err: networkError(err, file), success: false };
		}

		if (!rawResponse.ok) {
			return stateErr(file, `raw_url fetch returned ${rawResponse.status}`);
		}

		const raw = await rawResponse.text();
		return parseStateFile(raw, file);
	}

	return parseStateFile(entry.content, file);
}

async function readPathAsync(
	ctx: AdapterContext,
	environment: string,
): Promise<Result<StateRecord, StateError>> {
	const file = fileLabel(ctx.gistId, environment);
	const gist = await fetchGistBodyAsync(ctx, file);
	if (!gist.success) {
		return gist;
	}

	const entry = toGistFile(gist.data["files"], fileName(environment));
	if (entry === undefined) {
		return { data: {}, success: true };
	}

	// No version travels with the record: a gist offers no conditional
	// update, so the next write overwrites whatever is there.
	const parsed = await readGistContentAsync({
		entry,
		fetchFn: ctx.fetchFn,
		file,
		retry: ctx,
	});
	return parsed.success ? { data: { state: parsed.data }, success: true } : parsed;
}

async function sendPatchAsync(ctx: AdapterContext, body: string): Promise<Response> {
	const headers = buildHeaders(ctx.token);
	headers.set("Content-Type", "application/json");
	return ctx.fetchFn(`${GITHUB_API_BASE}/gists/${ctx.gistId}`, {
		body,
		headers,
		method: "PATCH",
	});
}

/**
 * Polls the gist until the just-written file is visible on a GET carrying the
 * content just written, with bounded retries. GitHub's gist API does not
 * guarantee read-your-write across replicas: a GET issued immediately after a
 * successful PATCH can omit the new file or, on an overwrite, still serve the
 * prior version from a stale replica. Matching content (not the filename,
 * which is stable across overwrites) is what proves the new write propagated,
 * so the poll pre-warms the cache the consumer's next read hits.
 *
 * Best-effort: resolves after exhausting the visibility budget regardless of
 * whether the content became visible. The PATCH already committed; the poll
 * only narrows the window in which subsequent reads can lag.
 *
 * Once a stale replica reveals its ETag, later polls replay it via
 * `If-None-Match`: a replica still serving the prior body answers `304 Not
 * Modified`, which GitHub does not bill against the primary REST rate limit,
 * so a slow-propagating write costs roughly one charged GET instead of one per
 * attempt.
 *
 * @param ctx - Adapter context carrying the injected fetch and sleep seams.
 * @param want - Environment file and serialized body the PATCH just wrote.
 */
async function waitForContentVisibilityAsync(
	ctx: AdapterContext,
	want: VisibilityTarget,
): Promise<void> {
	const target = fileName(want.environment);
	let etag: string | undefined;
	for (let attempt = 0; attempt < MAX_VISIBILITY_ATTEMPTS; attempt += 1) {
		try {
			const response = await sendGetAsync(ctx, etag);
			// Carry the replica's ETag forward (keeping the prior one when the
			// response omits it) so later polls stay conditional. Compare the
			// written body, not the filename: the name is stable across an
			// overwrite, so presence alone never proves propagation. Any absent
			// or malformed shape, or an empty 304 body, throws and drops to the
			// catch as "not yet visible" rather than accepting a stale replica.
			etag = response.headers.get("etag") ?? etag;
			const body = JSON.parse(await response.text());
			const files = Reflect.get(body, "files");
			const entry = Reflect.get(files, target);
			if (Reflect.get(entry, "content") === want.content) {
				return;
			}
		} catch {
			/* not yet visible; keep polling with the retained ETag. */
		}

		if (attempt < MAX_VISIBILITY_ATTEMPTS - 1) {
			await ctx.sleep(VISIBILITY_BASE_DELAY_MS * 2 ** attempt);
		}
	}
}

async function mapWriteFailureAsync(failure: HttpFailure): Promise<Result<void, StateError>> {
	const { file, response } = failure;
	if (response.status === 422) {
		return stateErr(
			file,
			`invalid PATCH body sent to github${await errorBodyDetailAsync(response)}`,
		);
	}

	return { err: await mapHttpErrorAsync(failure), success: false };
}

async function writePathAsync(
	ctx: AdapterContext,
	state: BedrockState,
): Promise<Result<void, StateError>> {
	const file = fileLabel(ctx.gistId, state.environment);
	const content = serializeStateFile(state);
	const body = JSON.stringify({
		files: { [fileName(state.environment)]: { content } },
	});

	let response: Response;
	try {
		response = await withRetryAsync(ctx, async () => sendPatchAsync(ctx, body));
	} catch (err) {
		return { err: networkError(err, file), success: false };
	}

	if (response.ok) {
		try {
			await waitForContentVisibilityAsync(ctx, { content, environment: state.environment });
		} catch {
			/**
			 * Visibility poll errors are non-fatal; the PATCH already
			 * committed.
			 */
		}

		return { data: undefined, success: true };
	}

	return mapWriteFailureAsync({ file, gistId: ctx.gistId, response });
}
