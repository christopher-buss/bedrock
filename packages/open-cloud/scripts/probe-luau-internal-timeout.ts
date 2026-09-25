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

import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

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

/**
 * Developer Forum thread for the acknowledged and mitigated January 2026
 * incident.
 */
export const INCIDENT_URL =
	"https://devforum.roblox.com/t/luau-execution-api-random-internal-timeouts/4256345";

/** Inputs of one probe run minus the pinned version. */
export interface ProbeTarget {
	/** Open Cloud origin, normally `https://apis.roblox.com`. */
	readonly apiBase: string;
	/**
	 * API key with `universe.place.luau-execution-session:write` and `:read`.
	 */
	readonly apiKey: string;
	/** Run-group label; groups are never pooled into one failure rate. */
	readonly group: string;
	/** Consecutive failed or unreadable polls before a task is given up. */
	readonly maxPollFailures: number;
	/** Hard cap on submit attempts, accepted or not. */
	readonly maxSubmits: number;
	/** How long one accepted task is watched before it is left as-is. */
	readonly observationMs: number;
	/** Target place id. */
	readonly placeId: string;
	/** Delay between task GETs. */
	readonly pollIntervalMs: number;
	/** Luau body of every task in the group. */
	readonly script: string;
	/** Accepted tasks to observe before the run halts on its own. */
	readonly targetAccepted: number;
	/** Target universe id. */
	readonly universeId: string;
}

/** Inputs of one probe run. `apiKey` is never written to an artifact. */
export interface ProbeConfig extends ProbeTarget {
	/** Pinned place version every task runs against. */
	readonly versionId: string;
}

/** Side-effecting collaborators, injected so the loop is testable. */
export interface ProbeDeps {
	/** Transport; the real `fetch` in production. */
	readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
	/** Progress sink; `console.log` in production. */
	readonly log: (line: string) => void;
	/** Epoch milliseconds clock. */
	readonly now: () => number;
	/** Delay; `setTimeout`-backed in production. */
	readonly sleep: (ms: number) => Promise<void>;
}

/**
 * One HTTP request and its reply, or the transport failure that replaced it.
 */
export interface Exchange {
	/** ISO timestamp when the request was sent. */
	readonly at: string;
	/** Raw response body; empty on transport failure. */
	readonly body: string;
	/** Wall time from send to body drained. */
	readonly durationMs: number;
	/** Lower-cased response headers, joined as `fetch` joins them. */
	readonly headers: Readonly<Record<string, string>>;
	/** HTTP method. */
	readonly method: "GET" | "POST";
	/** HTTP status; `0` when the request never produced a reply. */
	readonly status: number;
	/** Error message when the transport threw before any reply. */
	readonly transportError?: string | undefined;
	/** Request URL; carries resource ids but never the key. */
	readonly url: string;
}

/** Everything observed about one accepted task. */
export interface TaskRecord {
	/** Outcome bucket. */
	readonly classification: Classification;
	/** 1-based position among accepted tasks. */
	readonly index: number;
	/** Wall time from acceptance to the classifying poll. */
	readonly observedMs: number;
	/** Every task GET, oldest first. */
	readonly polls: ReadonlyArray<Exchange>;
	/** Identity read from the submit reply. */
	readonly ref: TaskRef;
	/** The submit exchange that created the task. */
	readonly submit: Exchange;
	/** Parsed body of the classifying poll, when there was one. */
	readonly terminal?: JSONValue | undefined;
}

/** A submit that did not create a task, kept out of the denominator. */
export interface SubmitRejection {
	/** The submit exchange. */
	readonly exchange: Exchange;
	/**
	 * `rate-limited` for a quota 429; `request-path` for transport
	 * failures, gateway errors, and replies without a task path.
	 */
	readonly kind: "rate-limited" | "request-path";
}

/** Full record of one run: the private artifact before redaction. */
export interface ProbeRun {
	/** Reason the run stopped before its caps, when it did. */
	readonly aborted?: string | undefined;
	/** ISO timestamp when the run ended. */
	readonly finishedAt: string;
	/** Run-group label. */
	readonly group: string;
	/** The caps the run was configured with. */
	readonly limits: {
		readonly maxPollFailures: number;
		readonly maxSubmits: number;
		readonly observationMs: number;
		readonly pollIntervalMs: number;
		readonly targetAccepted: number;
	};
	/** Submits that created no task. */
	readonly rejections: ReadonlyArray<SubmitRejection>;
	/** Luau body every task ran. */
	readonly script: string;
	/** ISO timestamp when the run began. */
	readonly startedAt: string;
	/** True when the run halted on an exact `internal-timeout` match. */
	readonly stoppedOnMatch: boolean;
	/** Universe, place, and pinned version the tasks ran against. */
	readonly target: {
		readonly placeId: string;
		readonly universeId: string;
		readonly versionId: string;
	};
	/** Every accepted task, oldest first: the denominator. */
	readonly tasks: ReadonlyArray<TaskRecord>;
}

/** Counts derived from a run. */
export interface Summary {
	/** Accepted tasks: the denominator of every rate. */
	readonly accepted: number;
	/** Accepted tasks per bucket. */
	readonly counts: Readonly<Record<Classification, number>>;
	/** Accepted tasks in the `internal-timeout` bucket. */
	readonly exactMatches: number;
	/** Submits kept out of the denominator, by kind. */
	readonly rejected: { readonly rateLimited: number; readonly requestPath: number };
	/**
	 * One-sided 95% upper bound on the true rate, present only when no
	 * exact match was observed in a non-empty sample.
	 */
	readonly upperBound?: number | undefined;
}

interface Context {
	readonly config: ProbeConfig;
	readonly deps: ProbeDeps;
}

interface RequestSpec {
	readonly body?: string | undefined;
	readonly method: "GET" | "POST";
	readonly url: string;
}

interface ObserveArgs {
	readonly index: number;
	readonly ref: TaskRef;
	readonly submit: Exchange;
}

type PollReading =
	| {
			readonly body: JSONValue;
			readonly classification: Classification;
			readonly kind: "terminal";
	  }
	| { readonly kind: "failed" | "pending" | "throttled" };

type SubmitOutcome =
	| { readonly holdMs: number; readonly kind: "aborted"; readonly reason: string }
	| { readonly holdMs: number; readonly kind: "accepted"; readonly task: TaskRecord }
	| { readonly holdMs: number; readonly kind: "rejected"; readonly rejection: SubmitRejection };

interface RunState {
	aborted?: string | undefined;
	holdMs: number;
	readonly rejections: Array<SubmitRejection>;
	stoppedOnMatch: boolean;
	submits: number;
	readonly tasks: Array<TaskRecord>;
}

interface Redaction {
	readonly replacements: ReadonlyArray<readonly [from: string, to: string]>;
}

/** Statuses that mean the key or target is wrong; more submits cannot help. */
const ABORT_STATUSES: ReadonlySet<number> = new Set([401, 403, 404]);

/** Hold after a transport failure or gateway error before the next submit. */
const FAILURE_BACKOFF_MS = 5000;

/** Bare ids at least this long are redacted wherever they appear. */
const MIN_BARE_ID_LENGTH = 6;

/** Response headers safe to keep in the public artifact. */
const PUBLIC_HEADERS: ReadonlySet<string> = new Set([
	"content-type",
	"date",
	"retry-after",
	"x-envoy-ratelimited",
	"x-envoy-upstream-service-time",
	"x-ratelimit-limit",
	"x-ratelimit-remaining",
	"x-ratelimit-reset",
]);

const PERCENT = 100;

const UNIVERSE = "<universe>";
const PLACE = "<place>";
const VERSION = "<version>";
const SESSION = "<session>";
const TASK = "<task>";

const INTERNAL_TIMEOUT: Classification = "internal-timeout";
const INTERNAL_ERROR_OTHER: Classification = "internal-error-other";

const CLASSIFICATIONS: ReadonlyArray<Classification> = [
	"cancelled",
	"complete",
	"deadline-exceeded",
	"failed-other",
	INTERNAL_ERROR_OTHER,
	INTERNAL_TIMEOUT,
	"observation-bound",
	"poll-failed",
];

/** Context for calls that do not need the pinned version yet. */
export interface DiscoveryContext {
	/** Run config minus the version. */
	readonly config: ProbeTarget;
	/** Transport, clock, sleep, and log. */
	readonly deps: ProbeDeps;
}

/** Everything the entry point needs that is not the pinned version. */
export interface EnvironmentSettings {
	/** Run config minus the version, which may still need discovery. */
	readonly config: ProbeTarget;
	/** Artifact root; the OS temp dir when unset. */
	readonly outputDir: string | undefined;
	/** Pinned version when the caller supplied one. */
	readonly versionId: string | undefined;
}

/** Outcome of reading the process environment. */
export type EnvironmentResult =
	| { readonly error: string; readonly ok: false }
	| { readonly ok: true; readonly settings: EnvironmentSettings };

/** Result of one head submit used only to learn the current version. */
export interface HeadVersion {
	/** The head submit exchange, kept in the private artifact. */
	readonly exchange: Exchange;
	/** Version segment of the returned task path, when there was one. */
	readonly versionId: string | undefined;
}

/** File names of one run's artifact set. */
export type ArtifactName = "private-run.json" | "public-report.md" | "public-run.json";

const ARTIFACT_NAMES: ReadonlyArray<ArtifactName> = [
	"private-run.json",
	"public-report.md",
	"public-run.json",
];

type Environment = Readonly<Record<string, string | undefined>>;

type CapKey =
	| "maxPollFailures"
	| "maxSubmits"
	| "observationMs"
	| "pollIntervalMs"
	| "targetAccepted";

interface CapSpec {
	readonly key: CapKey;
	readonly name: string;
	readonly fallback: number;
	readonly max: number;
}

/**
 * Produces the public artifact: every universe, place, version, session,
 * and task id becomes a placeholder, and only allow-listed response
 * headers survive. The API key is never in the run to begin with.
 *
 * @param run - The private run record.
 * @returns A structurally identical run safe to attach to a public report.
 */
export function redactJson(run: ProbeRun): ProbeRun {
	const rules = buildRedaction(run);
	return {
		...run,
		aborted: run.aborted === undefined ? undefined : applyReplacements(run.aborted, rules),
		rejections: run.rejections.map((rejection) => {
			return {
				...rejection,
				exchange: redactExchange(rejection.exchange, rules),
			};
		}),
		target: { placeId: PLACE, universeId: UNIVERSE, versionId: VERSION },
		tasks: run.tasks.map((task) => redactTask(task, rules)),
	};
}

/**
 * Counts a run's accepted tasks per bucket and its rejected submits per
 * kind. Every accepted task is in the denominator, including those left
 * at the observation bound.
 *
 * @param run - The run to count.
 * @returns The summary, with an upper bound only for a green sample.
 */
export function summarize(run: ProbeRun): Summary {
	const counts: Record<Classification, number> = {
		"cancelled": 0,
		"complete": 0,
		"deadline-exceeded": 0,
		"failed-other": 0,
		"internal-error-other": 0,
		"internal-timeout": 0,
		"observation-bound": 0,
		"poll-failed": 0,
	};
	for (const task of run.tasks) {
		counts[task.classification] += 1;
	}

	const accepted = run.tasks.length;
	const { "internal-timeout": exactMatches } = counts;
	return {
		accepted,
		counts,
		exactMatches,
		rejected: {
			rateLimited: run.rejections.filter((entry) => entry.kind === "rate-limited").length,
			requestPath: run.rejections.filter((entry) => entry.kind === "request-path").length,
		},
		upperBound:
			exactMatches === 0 && accepted > 0 ? zeroFailureUpperBound(accepted) : undefined,
	};
}

/**
 * Renders the human-readable report: verdict, denominator, per-bucket
 * counts, and, on an exact match, a regression contribution linked to
 * the acknowledged incident.
 *
 * @param run - The run to describe; pass the redacted run for a public copy.
 * @returns Markdown text.
 */
export function renderReport(run: ProbeRun): string {
	const summary = summarize(run);
	const lines = [
		`# Luau Execution internal-timeout probe: ${run.group}`,
		"",
		`- Started ${run.startedAt}, finished ${run.finishedAt}`,
		`- Target: universe ${run.target.universeId}, place ${run.target.placeId}, version ${run.target.versionId}`,
		`- Script: \`${run.script}\``,
		`- Caps: ${run.limits.targetAccepted.toString()} accepted tasks, ${run.limits.maxSubmits.toString()} submits, ${run.limits.observationMs.toString()} ms observation per task`,
		"",
		"## Result",
		"",
		...verdictLines(run, summary),
		"",
		"| Classification | Count |",
		"| --- | --- |",
		...CLASSIFICATIONS.map((name) => `| ${name} | ${summary.counts[name].toString()} |`),
		"",
		`Rejected submits, outside the denominator: ${summary.rejected.rateLimited.toString()} rate-limited, ${summary.rejected.requestPath.toString()} request-path.`,
		...regressionLines(run),
		...retainedSignatureLines(run),
	];
	return `${lines.join("\n")}\n`;
}

/**
 * Runs the serial probe: submit one task at the pinned version, watch it
 * to a terminal state or the observation bound, classify it, hold as the
 * quota headers dictate, and repeat until the accepted-task target, the
 * submit cap, an abort, or the first exact match.
 *
 * @param config - Target, caps, and script for this run group.
 * @param deps - Transport, clock, sleep, and log.
 * @returns The private run record.
 */
export async function runProbeAsync(config: ProbeConfig, deps: ProbeDeps): Promise<ProbeRun> {
	const context: Context = { config, deps };
	const startedAt = isoNow(deps);
	const state: RunState = {
		holdMs: 0,
		rejections: [],
		stoppedOnMatch: false,
		submits: 0,
		tasks: [],
	};

	while (shouldContinue(config, state)) {
		await holdAsync(context, state.holdMs);
		state.submits += 1;
		applyOutcome(state, await submitOnceAsync(context, state.tasks.length + 1));
	}

	return finishRun(context, { startedAt, state });
}

function applyReplacements(text: string, rules: Redaction): string {
	let result = text;
	for (const [from, to] of rules.replacements) {
		result = result.replaceAll(from, () => to);
	}

	return result;
}

function buildRedaction(run: ProbeRun): Redaction {
	const ids: Array<readonly [segment: string, id: string, placeholder: string]> = [
		["universes", run.target.universeId, UNIVERSE],
		["places", run.target.placeId, PLACE],
		["versions", run.target.versionId, VERSION],
	];
	for (const task of run.tasks) {
		ids.push(
			["luau-execution-sessions", task.ref.sessionId, SESSION],
			["tasks", task.ref.taskId, TASK],
		);
	}

	const replacements: Array<readonly [string, string]> = [];
	for (const [segment, id, placeholder] of ids) {
		replacements.push([`${segment}/${id}`, `${segment}/${placeholder}`]);
		if (id.length >= MIN_BARE_ID_LENGTH) {
			replacements.push([id, placeholder]);
		}
	}

	return { replacements };
}

function publicHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
	const kept: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		if (PUBLIC_HEADERS.has(name)) {
			kept[name] = value;
		}
	}

	return kept;
}

function redactExchange(exchange: Exchange, rules: Redaction): Exchange {
	return {
		...exchange,
		body: applyReplacements(exchange.body, rules),
		headers: publicHeaders(exchange.headers),
		transportError:
			exchange.transportError === undefined
				? undefined
				: applyReplacements(exchange.transportError, rules),
		url: applyReplacements(exchange.url, rules),
	};
}

function redactValue(value: JSONValue, rules: Redaction): JSONValue {
	if (typeof value === "string") {
		return applyReplacements(value, rules);
	}

	if (Array.isArray(value)) {
		return value.map((entry) => redactValue(entry, rules));
	}

	if (typeof value !== "object" || value === null) {
		return value;
	}

	const redacted: Record<string, JSONValue> = {};
	for (const [key, entry] of Object.entries(value)) {
		redacted[key] = redactValue(entry, rules);
	}

	return redacted;
}

function redactTask(task: TaskRecord, rules: Redaction): TaskRecord {
	return {
		...task,
		polls: task.polls.map((poll) => redactExchange(poll, rules)),
		ref: {
			path: applyReplacements(task.ref.path, rules),
			placeId: PLACE,
			sessionId: SESSION,
			taskId: TASK,
			universeId: UNIVERSE,
			versionId: VERSION,
		},
		submit: redactExchange(task.submit, rules),
		terminal: task.terminal === undefined ? undefined : redactValue(task.terminal, rules),
	};
}

function regressionLines(run: ProbeRun): ReadonlyArray<string> {
	const match = run.tasks.find((task) => task.classification === INTERNAL_TIMEOUT);
	if (match === undefined) {
		return [];
	}

	const lastPoll = match.polls.at(-1);
	return [
		"",
		"## Regression contribution",
		"",
		`Recurrence of the acknowledged and mitigated January 2026 incident: ${INCIDENT_URL}`,
		"",
		`- Task path: \`${match.ref.path}\``,
		`- Submitted: ${match.submit.at}`,
		`- Terminal state observed: ${lastPoll?.at ?? "(no poll)"}, ${match.observedMs.toString()} ms after acceptance`,
		`- Script: \`${run.script}\`, no binary input, no requested timeout`,
		"",
		"```json",
		match.terminal === undefined
			? "(no terminal body)"
			: JSON.stringify(match.terminal, undefined, 2),
		"```",
	];
}

function retainedSignatureLines(run: ProbeRun): ReadonlyArray<string> {
	const others = run.tasks.filter((task) => task.classification === INTERNAL_ERROR_OTHER);
	if (others.length === 0) {
		return [];
	}

	return [
		"",
		"## Other INTERNAL_ERROR signatures, reported separately",
		"",
		...others.map((task) => {
			return `- Task #${task.index.toString()} \`${task.ref.path}\`: ${JSON.stringify(task.terminal)}`;
		}),
	];
}

function verdictLines(run: ProbeRun, summary: Summary): ReadonlyArray<string> {
	const lines: Array<string> = [];
	if (run.aborted !== undefined) {
		lines.push(`Aborted: ${run.aborted}`, "");
	}

	if (summary.exactMatches > 0) {
		const index =
			run.tasks.find((task) => task.classification === INTERNAL_TIMEOUT)?.index ?? 0;
		lines.push(
			`**REPRODUCED**: exact \`FAILED / INTERNAL_ERROR / "${INTERNAL_TIMEOUT_MESSAGE}"\` on accepted task #${index.toString()} of ${summary.accepted.toString()}. The run stopped there.`,
		);
		return lines;
	}

	if (summary.accepted === 0) {
		lines.push("No accepted tasks; nothing to classify.");
		return lines;
	}

	const bound = ((summary.upperBound ?? 1) * PERCENT).toFixed(1);
	lines.push(
		`No reproduction in ${summary.accepted.toString()} accepted tasks (0/${summary.accepted.toString()} exact matches).`,
		`95% one-sided upper bound on the true rate: ${bound}%. This bounds the sample; it does not show the incident cannot recur.`,
	);
	return lines;
}

function applyOutcome(state: RunState, outcome: SubmitOutcome): void {
	state.holdMs = outcome.holdMs;
	if (outcome.kind === "aborted") {
		state.aborted = outcome.reason;
	} else if (outcome.kind === "rejected") {
		state.rejections.push(outcome.rejection);
	} else {
		state.tasks.push(outcome.task);
		state.stoppedOnMatch = outcome.task.classification === INTERNAL_TIMEOUT;
	}
}

function iso(epochMs: number): string {
	const date = new Date(epochMs);
	return date.toISOString();
}

function isoNow(deps: ProbeDeps): string {
	return iso(deps.now());
}

function finishRun(
	{ config, deps }: Context,
	args: { startedAt: string; state: RunState },
): ProbeRun {
	const { maxPollFailures, maxSubmits, observationMs, pollIntervalMs, targetAccepted } = config;
	return {
		aborted: args.state.aborted,
		finishedAt: isoNow(deps),
		group: config.group,
		limits: { maxPollFailures, maxSubmits, observationMs, pollIntervalMs, targetAccepted },
		rejections: args.state.rejections,
		script: config.script,
		startedAt: args.startedAt,
		stoppedOnMatch: args.state.stoppedOnMatch,
		target: {
			placeId: config.placeId,
			universeId: config.universeId,
			versionId: config.versionId,
		},
		tasks: args.state.tasks,
	};
}

async function holdAsync(context: Context, holdMs: number): Promise<void> {
	if (holdMs <= 0) {
		return;
	}

	context.deps.log(`hold ${holdMs.toString()} ms for the quota window`);
	await context.deps.sleep(holdMs);
}

function shouldContinue(config: ProbeConfig, state: RunState): boolean {
	return (
		state.aborted === undefined &&
		!state.stoppedOnMatch &&
		state.tasks.length < config.targetAccepted &&
		state.submits < config.maxSubmits
	);
}

async function exchangeAsync(
	{ config, deps }: DiscoveryContext,
	request: RequestSpec,
): Promise<Exchange> {
	const started = deps.now();
	const base = { at: iso(started), method: request.method, url: request.url };
	try {
		const response = await deps.fetch(request.url, {
			...(request.body === undefined ? {} : { body: request.body }),
			headers: { "content-type": "application/json", "x-api-key": config.apiKey },
			method: request.method,
		});
		const body = await response.text();
		return {
			...base,
			body,
			durationMs: deps.now() - started,
			headers: Object.fromEntries(response.headers.entries()),
			status: response.status,
		};
	} catch (err) {
		return {
			...base,
			body: "",
			durationMs: deps.now() - started,
			headers: {},
			status: 0,
			transportError: err instanceof Error ? err.message : String(err),
		};
	}
}

function isSuccess(status: number): boolean {
	const [min, max] = [200, 300];
	return status >= min && status < max;
}

function nextFailureCount(failures: number, reading: PollReading): number {
	if (reading.kind === "failed") {
		return failures + 1;
	}

	return reading.kind === "pending" ? 0 : failures;
}

function parseJson(text: string): JSONValue | undefined {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function readPoll(poll: Exchange): PollReading {
	if (poll.status === TOO_MANY_REQUESTS) {
		return { kind: "throttled" };
	}

	if (!isSuccess(poll.status)) {
		return { kind: "failed" };
	}

	const body = parseJson(poll.body);
	if (body === undefined) {
		return { kind: "failed" };
	}

	const reading = classifyTaskBody(body);
	if (reading === "pending" || reading === "unreadable") {
		return { kind: reading === "pending" ? "pending" : "failed" };
	}

	return { body, classification: reading, kind: "terminal" };
}

function settle(
	config: ProbeConfig,
	args: { elapsedMs: number; failures: number; reading: PollReading },
): Classification | undefined {
	if (args.reading.kind === "terminal") {
		return args.reading.classification;
	}

	if (args.failures >= config.maxPollFailures) {
		return "poll-failed";
	}

	return args.elapsedMs >= config.observationMs ? "observation-bound" : undefined;
}

async function observeTaskAsync(context: Context, args: ObserveArgs): Promise<TaskRecord> {
	const { config, deps } = context;
	const started = deps.now();
	const polls: Array<Exchange> = [];
	let failures = 0;

	for (;;) {
		await deps.sleep(config.pollIntervalMs);
		const poll = await exchangeAsync(context, {
			method: "GET",
			url: `${config.apiBase}/cloud/v2/${args.ref.path}`,
		});
		polls.push(poll);
		const reading = readPoll(poll);
		failures = nextFailureCount(failures, reading);
		const elapsedMs = deps.now() - started;
		const classification = settle(config, { elapsedMs, failures, reading });
		if (classification !== undefined) {
			const terminal = reading.kind === "terminal" ? reading.body : undefined;
			deps.log(`task #${args.index.toString()}: ${classification}`);
			return { ...args, classification, observedMs: elapsedMs, polls, terminal };
		}

		await holdAsync(context, quotaHoldMs(poll));
	}
}

async function submitOnceAsync(context: Context, index: number): Promise<SubmitOutcome> {
	const { config, deps } = context;
	const exchange = await exchangeAsync(context, {
		body: JSON.stringify({ script: config.script }),
		method: "POST",
		url: `${config.apiBase}/cloud/v2/universes/${config.universeId}/places/${config.placeId}/versions/${config.versionId}/luau-execution-session-tasks`,
	});
	deps.log(`submit for task #${index.toString()}: HTTP ${exchange.status.toString()}`);

	if (ABORT_STATUSES.has(exchange.status)) {
		const reason = `submit rejected with HTTP ${exchange.status.toString()}; check the key scopes and target ids`;
		return { holdMs: 0, kind: "aborted", reason };
	}

	if (exchange.status === TOO_MANY_REQUESTS) {
		return {
			holdMs: quotaHoldMs(exchange),
			kind: "rejected",
			rejection: { exchange, kind: "rate-limited" },
		};
	}

	const ref = isSuccess(exchange.status) ? parseTaskRef(exchange.body) : undefined;
	if (ref === undefined) {
		const holdMs = isSuccess(exchange.status) ? quotaHoldMs(exchange) : FAILURE_BACKOFF_MS;
		return { holdMs, kind: "rejected", rejection: { exchange, kind: "request-path" } };
	}

	const task = await observeTaskAsync(context, { index, ref, submit: exchange });
	return { holdMs: quotaHoldMs(exchange), kind: "accepted", task };
}

const DEFAULT_API_BASE = "https://apis.roblox.com";
const DEFAULT_GROUP = "trivial-baseline";
const DEFAULT_SCRIPT = 'return "ok"';

const REQUIRED_VARIABLES: ReadonlyArray<string> = [
	"ROBLOX_API_KEY",
	"ROBLOX_TEST_UNIVERSE_ID",
	"ROBLOX_TEST_PLACE_ID",
];

/**
 * Caps and their hard ceilings. The defaults are the issue's baseline
 * budget: 20 accepted tasks, watched for a little over the server's
 * 5-minute default task timeout. Raising a cap is the explicit follow-up
 * budget; the ceiling stops the run becoming an unbounded soak test.
 */
const CAP_SPECS: ReadonlyArray<CapSpec> = [
	{ key: "targetAccepted", name: "PROBE_ACCEPTED_TASKS", fallback: 20, max: 200 },
	{ key: "maxSubmits", name: "PROBE_MAX_SUBMITS", fallback: 40, max: 400 },
	{ key: "observationMs", name: "PROBE_OBSERVATION_MS", fallback: 330_000, max: 3_600_000 },
	{ key: "pollIntervalMs", name: "PROBE_POLL_INTERVAL_MS", fallback: 2000, max: 60_000 },
	{ key: "maxPollFailures", name: "PROBE_MAX_POLL_FAILURES", fallback: 5, max: 20 },
];

const INTEGER_PATTERN = /^\d+$/;

/**
 * Builds the three artifact files: the private record with every id and
 * header, and the public pair with ids replaced and headers filtered.
 * The head-discovery exchange goes only into the private record; its
 * task is outside the sample and its ids are not in the run's rules.
 *
 * @param run - The private run record.
 * @param versionDiscovery - The head submit used to learn the version, if any.
 * @returns File name to file text.
 */
export function artifactFiles(
	run: ProbeRun,
	versionDiscovery?: Exchange,
): Readonly<Record<ArtifactName, string>> {
	const redacted = redactJson(run);
	return {
		"private-run.json": JSON.stringify({ run, versionDiscovery }, undefined, 2),
		"public-report.md": renderReport(redacted),
		"public-run.json": JSON.stringify({ run: redacted }, undefined, 2),
	};
}

/**
 * Reads the run settings from the environment. Refuses without the
 * isolated-place opt-in, names every missing required variable, and
 * bounds each cap by its ceiling.
 *
 * @param environment - The process environment.
 * @returns The settings, or the first error found.
 */
export function parseEnvironment(environment: Environment): EnvironmentResult {
	const refusal = refusalFor(environment);
	if (refusal !== undefined) {
		return { error: refusal, ok: false };
	}

	const caps = readCaps(environment);
	if (typeof caps === "string") {
		return { error: caps, ok: false };
	}

	return {
		ok: true,
		settings: {
			config: {
				...caps,
				apiBase: environment["PROBE_API_BASE"] ?? DEFAULT_API_BASE,
				apiKey: environment["ROBLOX_API_KEY"] ?? "",
				group: environment["PROBE_GROUP"] ?? DEFAULT_GROUP,
				placeId: environment["ROBLOX_TEST_PLACE_ID"] ?? "",
				script: environment["PROBE_SCRIPT"] ?? DEFAULT_SCRIPT,
				universeId: environment["ROBLOX_TEST_UNIVERSE_ID"] ?? "",
			},
			outputDir: environment["PROBE_OUTPUT_DIR"],
			versionId: environment["ROBLOX_TEST_PLACE_VERSION_ID"],
		},
	};
}

/**
 * Learns the place's current version by submitting one task at head and
 * reading the resolved version out of the returned path. The place
 * resource does not expose its version. That task is not polled and
 * not part of the sample: head targeting is a separate dimension.
 *
 * @param context - Config without a version, plus deps.
 * @returns The exchange and the version, when the path carried one.
 */
export async function resolveHeadVersionAsync(context: DiscoveryContext): Promise<HeadVersion> {
	const { config } = context;
	const exchange = await exchangeAsync(context, {
		body: JSON.stringify({ script: config.script }),
		method: "POST",
		url: `${config.apiBase}/cloud/v2/universes/${config.universeId}/places/${config.placeId}/luau-execution-session-tasks`,
	});
	const versionId = isSuccess(exchange.status)
		? parseTaskRef(exchange.body)?.versionId
		: undefined;
	return { exchange, versionId };
}

function refusalFor(environment: Environment): string | undefined {
	if (environment["PROBE_ISOLATED_PLACE"] !== "1") {
		return "PROBE_ISOLATED_PLACE=1 is required: the probe submits real tasks against the target place, which must be isolated";
	}

	const missing = REQUIRED_VARIABLES.filter((name) => (environment[name] ?? "") === "");
	return missing.length > 0 ? `missing ${missing.join(", ")}` : undefined;
}

function readCap(environment: Environment, spec: CapSpec): number | string {
	const raw = environment[spec.name];
	if (raw === undefined) {
		return spec.fallback;
	}

	const value = INTEGER_PATTERN.test(raw) ? Number.parseInt(raw, 10) : 0;
	if (value < 1 || value > spec.max) {
		return `${spec.name} must be an integer from 1 to ${spec.max.toString()}`;
	}

	return value;
}

function readCaps(environment: Environment): Record<CapKey, number> | string {
	const caps: Record<CapKey, number> = {
		maxPollFailures: 0,
		maxSubmits: 0,
		observationMs: 0,
		pollIntervalMs: 0,
		targetAccepted: 0,
	};
	for (const spec of CAP_SPECS) {
		const value = readCap(environment, spec);
		if (typeof value === "string") {
			return value;
		}

		caps[spec.key] = value;
	}

	return caps;
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

function leadingInteger(raw: string | undefined): number | undefined {
	if (raw === undefined) {
		return undefined;
	}

	const [first = ""] = raw.split(",", 1);
	const parsed = Number.parseInt(first.trim(), 10);
	return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Exit code when the exact signature was observed; 0 is green, 1 is config or
 * abort.
 */
const EXIT_REPRODUCED = 2;

interface PinnedVersion {
	readonly discovery?: Exchange | undefined;
	readonly versionId: string;
}

function exitCode(run: ProbeRun): number {
	if (run.aborted !== undefined) {
		return 1;
	}

	return run.stoppedOnMatch ? EXIT_REPRODUCED : 0;
}

async function sleepAsync(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function liveDeps(): ProbeDeps {
	return {
		fetch: async (url, init) => fetch(url, init),
		log: (line) => {
			console.log(line);
		},
		now: Date.now,
		sleep: sleepAsync,
	};
}

async function pinVersionAsync(
	settings: EnvironmentSettings,
	deps: ProbeDeps,
): Promise<PinnedVersion | undefined> {
	if (settings.versionId !== undefined) {
		return { versionId: settings.versionId };
	}

	const head = await resolveHeadVersionAsync({ config: settings.config, deps });
	if (head.versionId === undefined) {
		console.error(
			`could not read a version from the head submit: HTTP ${head.exchange.status.toString()} ${head.exchange.body}`,
		);
		return undefined;
	}

	console.log(
		`pinned version ${head.versionId}, discovered by one head submit that is outside the sample`,
	);
	return { discovery: head.exchange, versionId: head.versionId };
}

async function writeArtifactsAsync(
	outputDirectory: string | undefined,
	args: { readonly discovery?: Exchange | undefined; readonly run: ProbeRun },
): Promise<string> {
	const stamp = args.run.startedAt.replaceAll(":", "-");
	const root = outputDirectory ?? join(tmpdir(), "bedrock-probe-luau-internal-timeout");
	const directory = join(root, `${args.run.group}-${stamp}`);
	await mkdir(directory, { recursive: true });
	const files = artifactFiles(args.run, args.discovery);
	await Promise.all(
		ARTIFACT_NAMES.map(async (name) => writeFile(join(directory, name), files[name], "utf8")),
	);
	return directory;
}

async function mainAsync(): Promise<number> {
	const parsed = parseEnvironment(process.env);
	if (!parsed.ok) {
		console.error(parsed.error);
		return 1;
	}

	const deps = liveDeps();
	const pinned = await pinVersionAsync(parsed.settings, deps);
	if (pinned === undefined) {
		return 1;
	}

	const run = await runProbeAsync(
		{ ...parsed.settings.config, versionId: pinned.versionId },
		deps,
	);
	const directory = await writeArtifactsAsync(parsed.settings.outputDir, {
		discovery: pinned.discovery,
		run,
	});
	console.log(`
${renderReport(redactJson(run))}`);
	console.log(`artifacts: ${directory}`);
	return exitCode(run);
}

if (import.meta.main) {
	process.exit(await mainAsync());
}
