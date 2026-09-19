// Serial probe for the Luau Execution internal-timeout regression: tasks
// that end `FAILED / INTERNAL_ERROR` with the exact message
// `Task timed out due to an internal error`.
//
// Why this probe exists: Roblox acknowledged and mitigated a service
// incident with exactly that terminal error in January 2026
// (https://devforum.roblox.com/t/luau-execution-api-random-internal-timeouts/4256345).
// Ocale's client retries and polls in ways that can hide which terminal
// error a task really reached, so this probe talks raw Open Cloud HTTP
// with no automatic retries, one pinned place version, and a trivial
// `return "ok"` body. Its first job is to name the exact terminal error
// of every accepted task, not to stress the service.
//
// How it works: submit one task at the pinned version, poll it to a
// terminal state or the observation bound, classify it, then submit the
// next. Submits are paced from the live `x-ratelimit-*` headers, never
// from a hardcoded quota. The run stops on the first exact
// `internal-timeout` match and preserves that task resource. It halts
// on its own after the configured number of accepted tasks (default
// 20) and never scales into a soak test on its own.
//
// Run with:
// PROBE_ISOLATED_PLACE=1 \
// ROBLOX_API_KEY=<key with universe.place.luau-execution-session:write,read> \
// ROBLOX_TEST_UNIVERSE_ID=<universe id> \
// ROBLOX_TEST_PLACE_ID=<place id> \
// bun packages/open-cloud/scripts/probe-luau-internal-timeout.ts
//
// Optional: ROBLOX_TEST_PLACE_VERSION_ID (skips head-version discovery),
// PROBE_ACCEPTED_TASKS (default 20), PROBE_MAX_SUBMITS, PROBE_OBSERVATION_MS,
// PROBE_GROUP, PROBE_SCRIPT, PROBE_OUTPUT_DIR.
//
// The script never writes to the repo. Artifacts go under
// PROBE_OUTPUT_DIR (default: the OS temp dir). It needs real Open Cloud
// credentials and an isolated place, so it cannot run in CI.

/** The message Roblox's January 2026 incident produced, matched verbatim. */
export const INTERNAL_TIMEOUT_MESSAGE = "Task timed out due to an internal error";

/**
 * Matches the version-pinned session task path the pinned submit returns.
 */
const PINNED_TASK_PATH_PATTERN =
	/^universes\/(\d+)\/places\/(\d+)\/versions\/(\d+)\/luau-execution-sessions\/([^/]+)\/tasks\/([^/]+)$/;

const MS_PER_SECOND = 1000;

/** Hold on a 429 that carries neither a reset nor a retry-after header. */
const FULL_WINDOW_MS = 60_000;

const DEFAULT_CONFIDENCE = 0.95;

const TOO_MANY_REQUESTS = 429;

/**
 * Outcome bucket for one accepted task. `internal-timeout` is the exact
 * regression signature; every other bucket is retained but never pooled
 * with it.
 */
export type Classification =
	| "cancelled"
	| "complete"
	| "deadline-exceeded"
	| "failed-other"
	| "internal-error-other"
	| "internal-timeout"
	| "observation-bound"
	| "poll-failed";

/**
 * Reading of one task GET body: a terminal bucket, still running, or
 * not a task object at all.
 */
export type BodyReading = "pending" | "unreadable" | Classification;

/** Identity of one accepted task, read from its resource path. */
export interface TaskRef {
	/** Full resource path as returned by the submit response. */
	readonly path: string;
	/** Place id segment of the path. */
	readonly placeId: string;
	/** Luau execution session id segment of the path. */
	readonly sessionId: string;
	/** Task id segment of the path. */
	readonly taskId: string;
	/** Universe id segment of the path. */
	readonly universeId: string;
	/** Pinned place version segment of the path. */
	readonly versionId: string;
}

/** Terminal and in-progress wire states, keyed by the wire enum. */
const READINGS: Readonly<Record<string, BodyReading>> = {
	CANCELLED: "cancelled",
	COMPLETE: "complete",
	PROCESSING: "pending",
	QUEUED: "pending",
	STATE_UNSPECIFIED: "pending",
};

/** Response status and lower-cased headers of one Open Cloud reply. */
export interface QuotaReading {
	/** Lower-cased response headers, joined the way `fetch` joins them. */
	readonly headers: Readonly<Record<string, string>>;
	/** HTTP status of the reply. */
	readonly status: number;
}

/**
 * Classifies one task GET body by its wire `state` and, for `FAILED`, by
 * the exact `error.code` and `error.message`.
 *
 * @param body - Parsed JSON body of a task GET.
 * @returns The terminal bucket, `pending` while the task still runs, or
 *   `unreadable` when the body is not a task object.
 */
export function classifyTaskBody(body: JSONValue): BodyReading {
	const record = asRecord(body);
	const state = record?.["state"];
	if (typeof state !== "string") {
		return "unreadable";
	}

	if (state === "FAILED") {
		return classifyFailure(record?.["error"]);
	}

	return READINGS[state] ?? "unreadable";
}

/**
 * Reads the pinned task resource path out of a submit response body.
 *
 * @param bodyText - Raw response body of the pinned submit.
 * @returns The task ref, or undefined when the body carries no pinned path.
 */
export function parseTaskRef(bodyText: string): TaskRef | undefined {
	const parsed = parseJson(bodyText);
	const body = parsed === undefined ? undefined : asRecord(parsed);
	const path = body?.["path"];
	if (typeof path !== "string") {
		return undefined;
	}

	const match = PINNED_TASK_PATH_PATTERN.exec(path);
	if (match === null) {
		return undefined;
	}

	const [, universeId = "", placeId = "", versionId = "", sessionId = "", taskId = ""] = match;
	return { path, placeId, sessionId, taskId, universeId, versionId };
}

/**
 * Computes how long to wait before the next call on the same operation,
 * from the live quota headers of the previous reply. Reads the leading
 * token of each header because `fetch` joins Roblox's per-operation and
 * global values under one name. `x-ratelimit-reset` is the true time to
 * the window edge; `retry-after` is a constant that understates it, so
 * it is only a fallback.
 *
 * @param reading - Status and headers of the previous reply.
 * @returns Milliseconds to hold, or 0 when budget remains.
 */
export function quotaHoldMs({ headers, status }: QuotaReading): number {
	const reset = leadingInteger(headers["x-ratelimit-reset"]);
	if (status === TOO_MANY_REQUESTS) {
		if (reset !== undefined) {
			return (reset + 1) * MS_PER_SECOND;
		}

		const retryAfter = leadingInteger(headers["retry-after"]);
		return retryAfter === undefined ? FULL_WINDOW_MS : retryAfter * MS_PER_SECOND;
	}

	const remaining = leadingInteger(headers["x-ratelimit-remaining"]);
	if (reset === undefined || remaining === undefined || remaining > 0) {
		return 0;
	}

	return (reset + 1) * MS_PER_SECOND;
}

/**
 * One-sided exact binomial upper bound on the true failure rate after
 * observing zero failures in `n` trials. This is what a green sample
 * can and cannot claim: `0/20` bounds the rate below about 14% at 95%.
 *
 * @param trials - Number of accepted tasks observed.
 * @param confidence - One-sided confidence level, default 0.95.
 * @returns The upper bound as a fraction in `(0, 1]`.
 */
export function zeroFailureUpperBound(trials: number, confidence = DEFAULT_CONFIDENCE): number {
	if (trials <= 0) {
		return 1;
	}

	return 1 - (1 - confidence) ** (1 / trials);
}

function asRecord(value: JSONValue): Record<string, JSONValue> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}

	return value;
}

function classifyFailure(error: JSONValue | undefined): Classification {
	const record = error === undefined ? undefined : asRecord(error);
	const code = record?.["code"];
	const message = record?.["message"];
	if (code === "INTERNAL_ERROR") {
		return message === INTERNAL_TIMEOUT_MESSAGE ? "internal-timeout" : "internal-error-other";
	}

	return code === "DEADLINE_EXCEEDED" ? "deadline-exceeded" : "failed-other";
}

function parseJson(text: string): JSONValue | undefined {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function leadingInteger(raw: string | undefined): number | undefined {
	if (raw === undefined) {
		return undefined;
	}

	const [first = ""] = raw.split(",", 1);
	const parsed = Number.parseInt(first.trim(), 10);
	return Number.isNaN(parsed) ? undefined : parsed;
}
