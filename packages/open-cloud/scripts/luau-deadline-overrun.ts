// Pure core of `probe-luau-deadline-overrun.ts`. Everything that can be
// reasoned about without the network lives here so it can be unit-tested:
// opt-in parsing, Luau source generation, wire-path parsing, the poll loop
// (with an injected `fetch` and clock), verdict classification, and evidence
// redaction. The shell entry only reads the environment and writes files.

import { createHash } from "node:crypto";

/** Default Open Cloud task timeout requested for every probe task, seconds. */
const DEFAULT_TIMEOUT_SECONDS = 5;
/** How often the task resource and the marker are polled. */
const DEFAULT_POLL_INTERVAL_MS = 1000;
/** How long a task is observed before the run declares it non-terminal. */
const DEFAULT_OBSERVATION_BOUND_MS = 60_000;

const OPT_IN_VARIABLE = "OCALE_PROBE_DISPOSABLE_PLACE";
const REQUIRED_VARIABLES = [
	"ROBLOX_API_KEY",
	"ROBLOX_TEST_UNIVERSE_ID",
	"ROBLOX_TEST_PLACE_ID",
] as const;

/** Everything the probe needs to address Open Cloud and bound its own run. */
export interface ProbeConfig {
	/** Open Cloud API key; never written to any record or log line. */
	readonly apiKey: string;
	/** How long a task is observed before the run declares it non-terminal. */
	readonly observationBoundMs: number;
	/** The disposable test place every task is submitted against. */
	readonly placeId: string;
	/**
	 * Immutable place version to pin to; resolved from one head submit when
	 * absent.
	 */
	readonly placeVersionId: string | undefined;
	/** Delay between successive task and marker reads. */
	readonly pollIntervalMs: number;
	/** Open Cloud `timeout` requested for every task, in seconds. */
	readonly timeoutSeconds: number;
	/** Universe that owns the place and the MemoryStore used for markers. */
	readonly universeId: string;
}

/**
 * Outcome of reading the environment: a config, or a reason the probe refused.
 */
export type ConfigResult =
	| {
			/** Discriminant: the probe must not run. */
			readonly ok: false;
			/** Operator-facing explanation; never echoes a variable's value. */
			readonly reason: string;
	  }
	| {
			/** Resolved configuration. */
			readonly config: ProbeConfig;
			/** Discriminant: the probe may run. */
			readonly ok: true;
	  };

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Reads the probe configuration from the environment. Refuses unless
 * `OCALE_PROBE_DISPOSABLE_PLACE` names the target place: the probe submits
 * deliberately non-terminating scripts and Open Cloud has no cancellation
 * operation, so it must never run against a shared place.
 *
 * @param environment - Process environment (or a test double of it).
 * @returns The config, or a refusal reason that never echoes a value.
 */
export function resolveProbeConfig(environment: Environment): ConfigResult {
	for (const name of REQUIRED_VARIABLES) {
		if (environment[name] === undefined || environment[name] === "") {
			return { ok: false, reason: `${name} must be set` };
		}
	}

	const apiKey = environment["ROBLOX_API_KEY"] ?? "";
	const universeId = environment["ROBLOX_TEST_UNIVERSE_ID"] ?? "";
	const placeId = environment["ROBLOX_TEST_PLACE_ID"] ?? "";

	if (environment[OPT_IN_VARIABLE] !== placeId) {
		return {
			ok: false,
			reason:
				`refusing to run: set ${OPT_IN_VARIABLE}=${placeId} to confirm place ${placeId} ` +
				"is a dedicated, disposable test place with no other submitters",
		};
	}

	return {
		config: {
			apiKey,
			observationBoundMs: DEFAULT_OBSERVATION_BOUND_MS,
			placeId,
			placeVersionId: environment["ROBLOX_TEST_PLACE_VERSION_ID"],
			pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
			timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
			universeId,
		},
		ok: true,
	};
}

/**
 * MemoryStore TTL for marker items, seconds. Long enough to outlive any run.
 */
const MARKER_TTL_SECONDS = 3600;

/** The three experiment scripts, in the order the probe submits them. */
export type ScriptKind = "busy" | "control" | "yielding";

/** A Luau source the probe submits, with its digest for the report. */
export interface ProbeScript {
	/** Which experiment step the script implements. */
	readonly kind: ScriptKind;
	/**
	 * Hex SHA-256 of `source`, so a reader can match the report to the wire.
	 */
	readonly sha256: string;
	/** Exact Luau submitted as the task's `script`. */
	readonly source: string;
}

/**
 * Name of the MemoryStore sorted map that holds a run's markers.
 *
 * @param runId - Unique id of this probe run.
 * @returns The sorted map id shared by the Luau scripts and the reader.
 */
export function markerMapId(runId: string): string {
	return `bedrock-probe-${runId}`;
}

/**
 * Hex SHA-256 of a string, as reported next to every submitted script.
 *
 * @param text - Text to digest.
 * @returns Lower-case hex digest.
 */
export function sha256Hex(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

/**
 * Builds the control script and the two non-terminating targets. Every
 * script first writes a `<kind>-started` marker so the reader can prove
 * the runtime reached user code before judging the task's native state.
 *
 * @param runId - Unique id of this probe run; scopes the marker map.
 * @returns Control, yielding target, busy target, in submission order.
 */
export function buildProbeScripts(runId: string): ReadonlyArray<ProbeScript> {
	const preamble = [
		'local MemoryStoreService = game:GetService("MemoryStoreService")',
		`local map = MemoryStoreService:GetSortedMap("${markerMapId(runId)}")`,
	];
	const bodies: ReadonlyArray<readonly [ScriptKind, ReadonlyArray<string>]> = [
		[
			"control",
			[
				markerLine("control", "started"),
				markerLine("control", "finished"),
				'return "control"',
			],
		],
		["yielding", [markerLine("yielding", "started"), "while true do", "\ttask.wait(1)", "end"]],
		["busy", [markerLine("busy", "started"), "while true do", "end"]],
	];

	return bodies.map(([kind, lines]) => {
		const source = [...preamble, ...lines].join("\n");
		return { kind, sha256: sha256Hex(source), source };
	});
}

function markerLine(kind: string, marker: string): string {
	return `map:SetAsync("${kind}-${marker}", DateTime.now():ToIsoDate(), ${MARKER_TTL_SECONDS.toString()})`;
}

const API_BASE = "https://apis.roblox.com/cloud/v2";

/**
 * Matches only the fully-qualified task path (version + session), the one
 * shape the GET operation accepts. The create call always returns it in
 * practice; anything else cannot be polled and is treated as unparseable.
 */
const TASK_PATH_PATTERN =
	/^universes\/(\d+)\/places\/(\d+)\/versions\/(\d+)\/luau-execution-sessions\/([^/]+)\/tasks\/([^/]+)$/;

/** Response header names kept as evidence, matched case-insensitively. */
const EVIDENCE_HEADER_PATTERN =
	/^(date|retry-after)$|ratelimit|request-id|correlation|trace|roblox|envoy/;

/**
 * Coordinates of a submitted task, parsed from the create response's `path`.
 */
export interface TaskRef {
	/** Place the task ran against. */
	readonly placeId: string;
	/** Execution session the task belongs to. */
	readonly sessionId: string;
	/** Task id within its session. */
	readonly taskId: string;
	/** Universe that owns the place. */
	readonly universeId: string;
	/** Immutable place version the task was pinned to. */
	readonly versionId: string;
}

/**
 * Where to submit: a version-pinned place, or head while no version is known.
 */
export interface SubmitTarget {
	/** Place to submit against. */
	readonly placeId: string;
	/** Universe that owns the place. */
	readonly universeId: string;
	/**
	 * Immutable version to pin to; `undefined` selects the mutable head
	 * endpoint.
	 */
	readonly versionId: string | undefined;
}

/** Coordinates of one marker item inside a run's sorted map. */
export interface MarkerRef {
	/** Sorted-map item id, for example `control-started`. */
	readonly itemId: string;
	/** Probe run whose map holds the item. */
	readonly runId: string;
	/** Universe whose MemoryStore holds the map. */
	readonly universeId: string;
}

/**
 * Parses a create response's `path` into the ids needed to poll the task.
 *
 * @param path - The `path` field of a `LuauExecutionSessionTask` body.
 * @returns The task ref, or `undefined` when the path cannot be polled.
 */
export function parseTaskPath(path: string): TaskRef | undefined {
	const match = TASK_PATH_PATTERN.exec(path);
	if (match === null) {
		return undefined;
	}

	const [, universeId = "", placeId = "", versionId = "", sessionId = "", taskId = ""] = match;
	return { placeId, sessionId, taskId, universeId, versionId };
}

/**
 * URL of the create operation for a place, pinned when a version is known.
 *
 * @param target - Universe, place, and optional version.
 * @returns Absolute Open Cloud URL.
 */
export function submitUrl({ placeId, universeId, versionId }: SubmitTarget): string {
	const place = `${API_BASE}/universes/${universeId}/places/${placeId}`;
	return versionId === undefined
		? `${place}/luau-execution-session-tasks`
		: `${place}/versions/${versionId}/luau-execution-session-tasks`;
}

/**
 * URL of the get operation for a submitted task.
 *
 * @param ref - Parsed task coordinates.
 * @returns Absolute Open Cloud URL.
 */
export function taskUrl({ placeId, sessionId, taskId, universeId, versionId }: TaskRef): string {
	return (
		`${API_BASE}/universes/${universeId}/places/${placeId}/versions/${versionId}` +
		`/luau-execution-sessions/${sessionId}/tasks/${taskId}`
	);
}

/**
 * URL of a marker item written by a probe script.
 *
 * @param ref - Universe, run, and item id.
 * @returns Absolute Open Cloud URL.
 */
export function markerUrl({ itemId, runId, universeId }: MarkerRef): string {
	return `${API_BASE}/universes/${universeId}/memory-store/sorted-maps/${markerMapId(runId)}/items/${itemId}`;
}

/**
 * Keeps the response headers that help Roblox correlate a request or that
 * explain pacing, and drops everything else (cookies, content headers).
 *
 * @param headers - Response headers.
 * @returns Lower-cased name to value, evidence headers only.
 */
export function captureHeaders(headers: Headers): Readonly<Record<string, string>> {
	const captured: Record<string, string> = {};
	for (const [name, value] of headers.entries()) {
		if (EVIDENCE_HEADER_PATTERN.test(name.toLowerCase())) {
			captured[name.toLowerCase()] = value;
		}
	}

	return captured;
}

const TERMINAL_STATES: ReadonlySet<string> = new Set(["CANCELLED", "COMPLETE", "FAILED"]);

/**
 * Which task a stage ran: the version bootstrap or one of the experiment
 * scripts.
 */
export type StageKind = "bootstrap" | ScriptKind;

/**
 * Everything the classifier needs about one stage, gathered by the poll loop.
 */
export interface Observation {
	/** `error.code` from the last task read, when the task failed. */
	readonly errorCode: string | undefined;
	/**
	 * `state` from the last successful task read; `undefined` if none
	 * succeeded.
	 */
	readonly finalState: string | undefined;
	/** Whether the `<kind>-finished` marker was read from MemoryStore. */
	readonly finishedSeen: boolean;
	/** Which stage produced the observation. */
	readonly kind: StageKind;
	/**
	 * Last non-404 failure reading a marker, e.g. `HTTP 403`; else
	 * `undefined`.
	 */
	readonly markerReadFailure: string | undefined;
	/** Whether the `<kind>-started` marker was read from MemoryStore. */
	readonly startedSeen: boolean;
	/** Whether the create call returned a task that can be polled. */
	readonly submitted: boolean;
}

/**
 * What one stage proved. `PASS_*` lets the run continue; everything else
 * stops it. `RED_*` and `LOST_TERMINAL_RESULT` are the reportable outcomes.
 */
export type Verdict =
	| "LOST_TERMINAL_RESULT"
	| "MARKER_SERVICE_FAILURE"
	| "MARKER_UNOBSERVED"
	| "PASS_COMPLETE"
	| "PASS_DEADLINE_EXCEEDED"
	| "RED_PROCESSING_AFTER_START"
	| "START_UNPROVEN"
	| "SUBMIT_REJECTED"
	| "UNEXPECTED_TERMINAL";

/** One line of the run summary: which stage ran and what it proved. */
export interface StageVerdict {
	/** Stage that ran. */
	readonly kind: StageKind;
	/** What it proved. */
	readonly verdict: Verdict;
}

/** Overall colour of a run, in the sense the issue defines. */
export type RunColour = "GREEN" | "INCONCLUSIVE" | "RED";

/**
 * Turns what the poll loop saw into a verdict. A task is red only when its
 * own script proved it started (marker present) and Open Cloud still shows
 * it non-terminal at the observation bound; the documented
 * `FAILED / DEADLINE_EXCEEDED` is a pass.
 *
 * @param observation - What the poll loop saw for one stage.
 * @returns The stage's verdict.
 */
export function classifyObservation(observation: Observation): Verdict {
	if (!observation.submitted) {
		return "SUBMIT_REJECTED";
	}

	if (observation.finalState === undefined || !TERMINAL_STATES.has(observation.finalState)) {
		return classifyNonTerminal(observation);
	}

	if (!isExpectedTerminal(observation)) {
		return "UNEXPECTED_TERMINAL";
	}

	if (!hasExpectedMarkers(observation)) {
		return "MARKER_UNOBSERVED";
	}

	return observation.kind === "bootstrap" || observation.kind === "control"
		? "PASS_COMPLETE"
		: "PASS_DEADLINE_EXCEEDED";
}

/**
 * Whether a stage's verdict lets the experiment proceed to the next stage.
 *
 * @param verdict - The stage's verdict.
 * @returns `true` for the two pass verdicts.
 */
export function isPass(verdict: Verdict): boolean {
	return verdict === "PASS_COMPLETE" || verdict === "PASS_DEADLINE_EXCEEDED";
}

/**
 * Grades a whole run. Red needs one confirmed-start task that outlived
 * its deadline; green needs the full ladder, busy target included, to
 * pass; anything cut short is inconclusive.
 *
 * @param stages - Verdicts in the order the stages ran.
 * @returns The run's colour.
 */
export function summarizeVerdicts(stages: ReadonlyArray<StageVerdict>): RunColour {
	const isRed = stages.some(({ verdict }) => {
		return verdict === "RED_PROCESSING_AFTER_START" || verdict === "LOST_TERMINAL_RESULT";
	});
	if (isRed) {
		return "RED";
	}

	const busyPassed = stages.some(({ kind, verdict }) => kind === "busy" && isPass(verdict));
	return busyPassed && stages.every(({ verdict }) => isPass(verdict)) ? "GREEN" : "INCONCLUSIVE";
}

function classifyNonTerminal(observation: Observation): Verdict {
	if (observation.finishedSeen) {
		return "LOST_TERMINAL_RESULT";
	}

	if (observation.startedSeen) {
		return "RED_PROCESSING_AFTER_START";
	}

	return observation.markerReadFailure === undefined
		? "START_UNPROVEN"
		: "MARKER_SERVICE_FAILURE";
}

function isExpectedTerminal(observation: Observation): boolean {
	switch (observation.kind) {
		case "bootstrap":
		case "control": {
			return observation.finalState === "COMPLETE";
		}
		case "busy":
		case "yielding": {
			return (
				observation.finalState === "FAILED" && observation.errorCode === "DEADLINE_EXCEEDED"
			);
		}
	}
}

function hasExpectedMarkers(observation: Observation): boolean {
	switch (observation.kind) {
		case "bootstrap": {
			return true;
		}
		case "busy":
		case "yielding": {
			return observation.startedSeen;
		}
		case "control": {
			return observation.startedSeen && observation.finishedSeen;
		}
	}
}

/**
 * Per-request transport cap; a hung socket must not eat the observation bound.
 */
const REQUEST_TIMEOUT_MS = 15_000;
const HTTP_NOT_FOUND = 404;
const BOOTSTRAP_SCRIPT = "return 0";

/** One line of evidence. Written verbatim into the private JSONL artifact. */
export interface ProbeRecord {
	/** Wall-clock time the record was made, ISO 8601. */
	readonly at: string;
	/** Free-form payload; anything JSON-compatible. */
	readonly detail: Readonly<Record<string, unknown>>;
	/**
	 * What happened: `submit`, `task`, `marker`, `*-transport-error`,
	 * `verdict`, or `summary`.
	 */
	readonly event: string;
	/** Probe run the record belongs to. */
	readonly runId: string;
	/** Stage that produced the record. */
	readonly stage: StageKind;
}

/**
 * Side-effecting collaborators, injected so the loop is testable without a
 * network.
 */
export interface ProbeDeps {
	/** Receives every evidence record as it is made. */
	readonly emit: (record: ProbeRecord) => void;
	/**
	 * HTTP transport; called exactly once per logical request, never retried.
	 */
	readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
	/** Wall clock. */
	readonly now: () => Date;
	/** Pauses between polls. */
	readonly sleepAsync: (ms: number) => Promise<void>;
}

/** What one stage submitted, saw, and concluded. */
export interface StageResult {
	/** Stage that ran. */
	readonly kind: StageKind;
	/** What the poll loop saw. */
	readonly observation: Observation;
	/** Number of task reads attempted. */
	readonly polls: number;
	/** Hex SHA-256 of the submitted script. */
	readonly sha256: string;
	/** Full task resource path when the submit succeeded. */
	readonly taskPath: string | undefined;
	/** The stage's verdict. */
	readonly verdict: Verdict;
}

/** Everything the run concluded, for the console summary and the report. */
export interface RunSummary {
	/** Overall grade. */
	readonly colour: RunColour;
	/**
	 * Immutable place version every experiment task was pinned to, when
	 * resolved.
	 */
	readonly placeVersionId: string | undefined;
	/** Probe run id. */
	readonly runId: string;
	/** Stages in the order they ran; the ladder stops at the first non-pass. */
	readonly stages: ReadonlyArray<StageResult>;
}

/** Inputs to {@link runProbeAsync}. */
export interface RunProbeOptions {
	/** Resolved configuration. */
	readonly config: ProbeConfig;
	/** Injected collaborators. */
	readonly deps: ProbeDeps;
	/** Unique id for this run; scopes the marker map and the artifacts. */
	readonly runId: string;
}

interface LadderContext {
	readonly config: ProbeConfig;
	readonly deps: ProbeDeps;
	readonly runId: string;
}

interface StageContext extends LadderContext {
	readonly kind: StageKind;
	readonly source: string;
	readonly target: SubmitTarget;
}

interface StageSpec {
	readonly kind: StageKind;
	readonly source: string;
	readonly versionId: string | undefined;
}

interface HttpOutcome {
	readonly body: JSONValue | undefined;
	readonly bodyText: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly status: number;
}

interface HttpRequest {
	readonly body?: string;
	readonly event: string;
	readonly url: string;
}

interface MutableObservation {
	errorCode: string | undefined;
	finalState: string | undefined;
	finishedSeen: boolean;
	markerReadFailure: string | undefined;
	startedSeen: boolean;
}

interface StageOutcome {
	readonly observation: Observation;
	readonly polls: number;
	readonly ref: TaskRef | undefined;
}

type MarkerRead = "absent" | "failed" | "seen";

/**
 * Runs the experiment ladder: resolve (or accept) an immutable place
 * version, then submit the control, the yielding target, and the busy
 * target in turn, each pinned to that version and observed for the bound.
 * Stops at the first stage that does not pass, because Open Cloud has no
 * cancellation and a non-terminal task must not be stacked on.
 *
 * @param options - Config, run id, and injected collaborators.
 * @returns Every stage that ran and the run's overall colour.
 */
export async function runProbeAsync(options: RunProbeOptions): Promise<RunSummary> {
	const { deps, runId } = options;
	const stages: Array<StageResult> = [];
	const placeVersionId = await runLadderAsync(options, stages);
	const colour = summarizeVerdicts(stages);
	deps.emit({
		at: deps.now().toISOString(),
		detail: {
			colour,
			placeVersionId,
			stages: stages.map(({ kind, verdict }) => ({ kind, verdict })),
		},
		event: "summary",
		runId,
		stage: stages.at(-1)?.kind ?? "bootstrap",
	});
	return { colour, placeVersionId, runId, stages };
}

function stageContext(ladder: LadderContext, stage: StageSpec): StageContext {
	return {
		...ladder,
		kind: stage.kind,
		source: stage.source,
		target: {
			placeId: ladder.config.placeId,
			universeId: ladder.config.universeId,
			versionId: stage.versionId,
		},
	};
}

function emitRecord(context: StageContext, record: Pick<ProbeRecord, "detail" | "event">): void {
	context.deps.emit({
		at: context.deps.now().toISOString(),
		detail: record.detail,
		event: record.event,
		runId: context.runId,
		stage: context.kind,
	});
}

function readString(body: JSONValue | undefined, key: string): string | undefined {
	if (body === undefined || body === null || typeof body !== "object" || Array.isArray(body)) {
		return undefined;
	}

	const value = body[key];
	return typeof value === "string" ? value : undefined;
}

function parseJson(text: string): JSONValue | undefined {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/**
 * One request, one response, no retry. A transport failure is recorded and
 * surfaces as `undefined` so the caller's loop keeps its cadence.
 *
 * @param context - Stage being observed; supplies the key and the sink.
 * @param request - URL, optional JSON body, and the event name to record.
 * @returns Status, headers, and body, or `undefined` on transport failure.
 */
async function requestAsync(
	context: StageContext,
	request: HttpRequest,
): Promise<HttpOutcome | undefined> {
	const headers: Record<string, string> = { "x-api-key": context.config.apiKey };
	const init: RequestInit = {
		headers,
		method: request.body === undefined ? "GET" : "POST",
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	};
	if (request.body !== undefined) {
		headers["content-type"] = "application/json";
		init.body = request.body;
	}

	try {
		const response = await context.deps.fetch(request.url, init);
		const bodyText = await response.text();
		return {
			body: parseJson(bodyText),
			bodyText,
			headers: captureHeaders(response.headers),
			status: response.status,
		};
	} catch (err) {
		emitRecord(context, {
			detail: { message: String(err), url: request.url },
			event: `${request.event}-transport-error`,
		});
		return undefined;
	}
}

async function submitAsync(context: StageContext): Promise<TaskRef | undefined> {
	const url = submitUrl(context.target);
	const body = JSON.stringify({
		script: context.source,
		timeout: `${context.config.timeoutSeconds.toString()}s`,
	});
	const outcome = await requestAsync(context, { body, event: "submit", url });
	if (outcome === undefined) {
		return undefined;
	}

	const path = readString(outcome.body, "path");
	emitRecord(context, {
		detail: {
			body: outcome.bodyText,
			headers: outcome.headers,
			requestBody: body,
			status: outcome.status,
			taskPath: path,
			url,
		},
		event: "submit",
	});
	return path === undefined ? undefined : parseTaskPath(path);
}

function taskPathOf({ placeId, sessionId, taskId, universeId, versionId }: TaskRef): string {
	return (
		`universes/${universeId}/places/${placeId}/versions/${versionId}` +
		`/luau-execution-sessions/${sessionId}/tasks/${taskId}`
	);
}

function finishStage(context: StageContext, outcome: StageOutcome): StageResult {
	const verdict = classifyObservation(outcome.observation);
	const taskPath = outcome.ref === undefined ? undefined : taskPathOf(outcome.ref);
	emitRecord(context, {
		detail: { observation: outcome.observation, polls: outcome.polls, taskPath, verdict },
		event: "verdict",
	});
	return {
		kind: context.kind,
		observation: outcome.observation,
		polls: outcome.polls,
		sha256: sha256Hex(context.source),
		taskPath,
		verdict,
	};
}

function readErrorCode(body: JSONValue | undefined): string | undefined {
	if (body === undefined || body === null || typeof body !== "object" || Array.isArray(body)) {
		return undefined;
	}

	return readString(body["error"], "code");
}

function isSuccess(status: number): boolean {
	return status >= 200 && status < 300;
}

async function readTaskAsync(
	context: StageContext,
	ref: TaskRef,
): Promise<HttpOutcome | undefined> {
	const outcome = await requestAsync(context, { event: "task", url: taskUrl(ref) });
	if (outcome === undefined) {
		return undefined;
	}

	emitRecord(context, {
		detail: {
			body: outcome.bodyText,
			errorCode: readErrorCode(outcome.body),
			headers: outcome.headers,
			state: readString(outcome.body, "state"),
			status: outcome.status,
		},
		event: "task",
	});
	return outcome;
}

async function readMarkerAsync(context: StageContext, marker: string): Promise<MarkerRead> {
	const url = markerUrl({
		itemId: `${context.kind}-${marker}`,
		runId: context.runId,
		universeId: context.config.universeId,
	});
	const outcome = await requestAsync(context, { event: "marker", url });
	if (outcome === undefined) {
		return "failed";
	}

	const isSeen = isSuccess(outcome.status);
	emitRecord(context, {
		detail: {
			body: outcome.bodyText,
			headers: outcome.headers,
			marker,
			status: outcome.status,
			value: isSeen ? readString(outcome.body, "value") : undefined,
		},
		event: "marker",
	});
	if (isSeen) {
		return "seen";
	}

	return outcome.status === HTTP_NOT_FOUND ? "absent" : "failed";
}

async function readMarkersAsync(context: StageContext, state: MutableObservation): Promise<void> {
	if (context.kind === "bootstrap") {
		return;
	}

	if (!state.startedSeen) {
		const started = await readMarkerAsync(context, "started");
		state.startedSeen = started === "seen";
		if (started === "failed") {
			state.markerReadFailure = "marker read failed";
		}
	}

	if (context.kind === "control" && !state.finishedSeen) {
		state.finishedSeen = (await readMarkerAsync(context, "finished")) === "seen";
	}
}

async function observeAsync(context: StageContext, ref: TaskRef): Promise<StageResult> {
	const state: MutableObservation = {
		errorCode: undefined,
		finalState: undefined,
		finishedSeen: false,
		markerReadFailure: undefined,
		startedSeen: false,
	};
	const startedAt = context.deps.now().getTime();
	let polls = 0;

	while (context.deps.now().getTime() - startedAt < context.config.observationBoundMs) {
		polls += 1;
		const outcome = await readTaskAsync(context, ref);
		if (outcome !== undefined && isSuccess(outcome.status)) {
			state.finalState = readString(outcome.body, "state") ?? state.finalState;
			state.errorCode = readErrorCode(outcome.body) ?? state.errorCode;
		}

		await readMarkersAsync(context, state);
		if (state.finalState !== undefined && TERMINAL_STATES.has(state.finalState)) {
			break;
		}

		await context.deps.sleepAsync(context.config.pollIntervalMs);
	}

	const observation: Observation = { ...state, kind: context.kind, submitted: true };
	return finishStage(context, { observation, polls, ref });
}

async function runStageAsync(context: StageContext): Promise<StageResult> {
	const ref = await submitAsync(context);
	if (ref !== undefined) {
		return observeAsync(context, ref);
	}

	const observation: Observation = {
		errorCode: undefined,
		finalState: undefined,
		finishedSeen: false,
		kind: context.kind,
		markerReadFailure: undefined,
		startedSeen: false,
		submitted: false,
	};
	return finishStage(context, { observation, polls: 0, ref });
}

/**
 * Walks the ladder. The bootstrap submits a trivial script at head only to
 * learn the immutable version; every later stage is pinned to it.
 *
 * @param ladder - Config, run id, and collaborators.
 * @param stages - Receives each stage result as it completes.
 * @returns The pinned version id, or `undefined` when it was never resolved.
 */
async function runLadderAsync(
	ladder: LadderContext,
	stages: Array<StageResult>,
): Promise<string | undefined> {
	let versionId = ladder.config.placeVersionId;
	if (versionId === undefined) {
		const bootstrap = await runStageAsync(
			stageContext(ladder, { kind: "bootstrap", source: BOOTSTRAP_SCRIPT, versionId }),
		);
		stages.push(bootstrap);
		versionId =
			bootstrap.taskPath === undefined
				? undefined
				: parseTaskPath(bootstrap.taskPath)?.versionId;
	}

	for (const script of buildProbeScripts(ladder.runId)) {
		const last = stages.at(-1);
		if (versionId === undefined || (last !== undefined && !isPass(last.verdict))) {
			break;
		}

		stages.push(
			await runStageAsync(
				stageContext(ladder, { kind: script.kind, source: script.source, versionId }),
			),
		);
	}

	return versionId;
}
