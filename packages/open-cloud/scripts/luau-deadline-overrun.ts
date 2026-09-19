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
