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
