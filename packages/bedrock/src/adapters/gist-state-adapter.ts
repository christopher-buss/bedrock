import type { Result } from "@bedrock-rbx/ocale";

import { validateEnvironmentName } from "../core/environment.ts";
import { parseStateFile, serializeStateFile } from "../core/state-file.ts";
import type { BedrockState, StateError } from "../core/state.ts";
import type { StatePort } from "../ports/state-port.ts";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";
const USER_AGENT = "bedrock";
const MAX_INLINE_BYTES = 10_000_000;
const MAX_RETRIES = 3;
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([409, 502, 503, 504]);

/**
 * Minimal `fetch`-compatible signature the adapter needs, narrower than
 * `typeof globalThis.fetch` so test fakes do not have to stub runtime
 * extensions such as `fetch.preconnect`.
 */
export type GistFetch = (
	input: globalThis.Request | string | URL,
	init?: RequestInit,
) => Promise<Response>;

/**
 * Configuration for {@link createGistStateAdapter}.
 */
export interface GistStateAdapterDeps {
	/** Injection seam for tests; defaults to `globalThis.fetch`. */
	readonly fetch?: GistFetch | undefined;
	/** ID of an existing GitHub Gist that holds this project's state files. */
	readonly gistId: string;
	/**
	 * Injection seam for retry backoff timing; defaults to a `setTimeout`-based
	 * promise. Tests pass a fake to keep retry assertions deterministic.
	 */
	readonly sleep?: ((ms: number) => Promise<void>) | undefined;
	/** GitHub token (fine-grained PAT or classic PAT) with gist read/write scope. */
	readonly token: string;
}

interface AdapterContext {
	readonly fetchFn: GistFetch;
	readonly gistId: string;
	readonly sleep: (ms: number) => Promise<void>;
	readonly token: string;
}

interface GistFile {
	readonly content: string | undefined;
	readonly isTruncated: boolean;
	readonly rawUrl: string | undefined;
	readonly size: number;
}

interface HttpFailure {
	readonly file: string;
	readonly gistId: string;
	readonly status: number;
}

interface ReadContentParameters {
	readonly entry: GistFile;
	readonly fetchFn: GistFetch;
	readonly file: string;
	readonly sleep: (ms: number) => Promise<void>;
}

/**
 * Build a `StatePort` that persists Bedrock state in a GitHub Gist.
 *
 * One gist holds one file per environment, named `state.<env>.json`. The
 * adapter authenticates with a user-supplied token and speaks the GitHub
 * REST API directly; no SDK dependency.
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
 *         expect(result.data).toBeUndefined();
 *     }
 * });
 * ```
 *
 * @param deps - Gist ID, GitHub token, and optional fetch override.
 * @returns A `StatePort` ready to be passed to `deploy()`.
 */
export function createGistStateAdapter(deps: GistStateAdapterDeps): StatePort {
	const ctx: AdapterContext = {
		fetchFn: deps.fetch ?? globalThis.fetch.bind(globalThis),
		gistId: deps.gistId,
		sleep: deps.sleep ?? defaultSleep,
		token: deps.token,
	};

	return {
		async read(environment) {
			const safe = validateEnvironmentName(environment);
			if (!safe.success) {
				return safe;
			}

			return readPath(ctx, safe.data);
		},
		async write(state) {
			const safe = validateEnvironmentName(state.environment);
			if (!safe.success) {
				return safe;
			}

			return writePath(ctx, state);
		},
	};
}

async function defaultSleep(ms: number): Promise<void> {
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

function toGistFile(entry: unknown): GistFile | undefined {
	if (typeof entry !== "object" || entry === null) {
		return undefined;
	}

	const record = entry as Record<string, unknown>;
	const content = typeof record["content"] === "string" ? record["content"] : undefined;
	const rawUrl = typeof record["raw_url"] === "string" ? record["raw_url"] : undefined;
	const size = typeof record["size"] === "number" ? record["size"] : 0;
	const isTruncated = record["truncated"] === true;
	return { content, isTruncated, rawUrl, size };
}

function mapHttpError({ file, gistId, status }: HttpFailure): StateError {
	if (status === 404) {
		return { file, kind: "stateError", reason: `gist ${gistId} not found: check gistId` };
	}

	if (status === 401 || status === 403) {
		return { file, kind: "stateError", reason: `auth failed (${status}): check token scopes` };
	}

	return { file, kind: "stateError", reason: `github returned ${status}` };
}

function networkError(error: unknown, file: string): StateError {
	const message = error instanceof Error ? error.message : String(error);
	return { file, kind: "stateError", reason: `network error: ${message}` };
}

function buildHeaders(token: string): Headers {
	const headers = new Headers();
	headers.set("Accept", "application/vnd.github+json");
	headers.set("Authorization", `Bearer ${token}`);
	headers.set("User-Agent", USER_AGENT);
	headers.set("X-GitHub-Api-Version", GITHUB_API_VERSION);
	return headers;
}

async function sendGet(ctx: AdapterContext): Promise<Response> {
	return ctx.fetchFn(`${GITHUB_API_BASE}/gists/${ctx.gistId}`, {
		headers: buildHeaders(ctx.token),
		method: "GET",
	});
}

function isRetryableStatus(status: number): boolean {
	return RETRYABLE_STATUSES.has(status);
}

function backoffMs(attempt: number): number {
	return 1000 * 2 ** attempt;
}

async function withRetry(
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

async function fetchGistBody(
	ctx: AdapterContext,
	file: string,
): Promise<Result<Record<string, unknown>, StateError>> {
	let response: Response;
	try {
		response = await withRetry(ctx.sleep, async () => sendGet(ctx));
	} catch (err) {
		return { err: networkError(err, file), success: false };
	}

	if (!response.ok) {
		return {
			err: mapHttpError({ file, gistId: ctx.gistId, status: response.status }),
			success: false,
		};
	}

	const body = (await response.json()) as Record<string, unknown>;
	return { data: body, success: true };
}

function stateErr<T>(file: string, reason: string): Result<T, StateError> {
	return { err: { file, kind: "stateError", reason }, success: false };
}

async function readGistContent({
	entry,
	fetchFn,
	file,
	sleep,
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
			rawResponse = await withRetry(sleep, async () => fetchFn(rawUrl));
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

async function readPath(
	ctx: AdapterContext,
	environment: string,
): Promise<Result<BedrockState | undefined, StateError>> {
	const file = fileLabel(ctx.gistId, environment);
	const gist = await fetchGistBody(ctx, file);
	if (!gist.success) {
		return gist;
	}

	const files = gist.data["files"] as Record<string, unknown> | undefined;
	const entry = toGistFile(files?.[fileName(environment)]);
	if (entry === undefined) {
		return { data: undefined, success: true };
	}

	return readGistContent({ entry, fetchFn: ctx.fetchFn, file, sleep: ctx.sleep });
}

async function sendPatch(ctx: AdapterContext, body: string): Promise<Response> {
	const headers = buildHeaders(ctx.token);
	headers.set("Content-Type", "application/json");
	return ctx.fetchFn(`${GITHUB_API_BASE}/gists/${ctx.gistId}`, {
		body,
		headers,
		method: "PATCH",
	});
}

async function writePath(
	ctx: AdapterContext,
	state: BedrockState,
): Promise<Result<void, StateError>> {
	const file = fileLabel(ctx.gistId, state.environment);
	const body = JSON.stringify({
		files: { [fileName(state.environment)]: { content: serializeStateFile(state) } },
	});

	let response: Response;
	try {
		response = await withRetry(ctx.sleep, async () => sendPatch(ctx, body));
	} catch (err) {
		return { err: networkError(err, file), success: false };
	}

	if (response.ok) {
		return { data: undefined, success: true };
	}

	if (response.status === 422) {
		return stateErr(file, "invalid PATCH body sent to github");
	}

	return {
		err: mapHttpError({ file, gistId: ctx.gistId, status: response.status }),
		success: false,
	};
}
