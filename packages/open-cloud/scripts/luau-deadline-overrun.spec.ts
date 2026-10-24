import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
	buildProbeScripts,
	captureHeaders,
	classifyObservation,
	markerUrl,
	parseTaskPath,
	redactRecord,
	resolveProbeConfig,
	runProbeAsync,
	sha256Hex,
	submitUrl,
	summarizeVerdicts,
	taskUrl,
	toJsonl,
} from "./luau-deadline-overrun.ts";
import type {
	Observation,
	ProbeConfig,
	ProbeDeps,
	ProbeRecord,
	StageKind,
} from "./luau-deadline-overrun.ts";

const VALID_ENV = {
	OCALE_PROBE_DISPOSABLE_PLACE: "222",
	ROBLOX_API_KEY: "secret-key-value",
	ROBLOX_TEST_PLACE_ID: "222",
	ROBLOX_TEST_UNIVERSE_ID: "111",
};

describe(resolveProbeConfig, () => {
	it("should resolve a config when the disposable-place opt-in names the target place", () => {
		expect.assertions(1);

		expect(resolveProbeConfig(VALID_ENV)).toStrictEqual({
			config: {
				apiKey: "secret-key-value",
				observationBoundMs: 60_000,
				placeId: "222",
				placeVersionId: undefined,
				pollIntervalMs: 1000,
				timeoutSeconds: 5,
				universeId: "111",
			},
			ok: true,
		});
	});

	it("should pin to an explicit place version when one is supplied", () => {
		expect.assertions(1);

		const result = resolveProbeConfig({ ...VALID_ENV, ROBLOX_TEST_PLACE_VERSION_ID: "7" });

		expect(result.ok && result.config.placeVersionId).toBe("7");
	});

	it("should refuse to run without the disposable-place opt-in", () => {
		expect.assertions(1);

		const { OCALE_PROBE_DISPOSABLE_PLACE: _optIn, ...environment } = VALID_ENV;

		expect(resolveProbeConfig(environment)).toStrictEqual({
			ok: false,
			reason: "refusing to run: set OCALE_PROBE_DISPOSABLE_PLACE=222 to confirm place 222 is a dedicated, disposable test place with no other submitters",
		});
	});

	it("should refuse to run when the opt-in names a different place", () => {
		expect.assertions(1);

		const result = resolveProbeConfig({ ...VALID_ENV, OCALE_PROBE_DISPOSABLE_PLACE: "999" });

		expect(result).toStrictEqual({
			ok: false,
			reason: "refusing to run: set OCALE_PROBE_DISPOSABLE_PLACE=222 to confirm place 222 is a dedicated, disposable test place with no other submitters",
		});
	});

	it.for(["ROBLOX_API_KEY", "ROBLOX_TEST_UNIVERSE_ID", "ROBLOX_TEST_PLACE_ID"])(
		"should name %s when it is missing without echoing any value",
		(name) => {
			expect.assertions(2);

			const environment: Record<string, string | undefined> = {
				...VALID_ENV,
				[name]: undefined,
			};
			const result = resolveProbeConfig(environment);

			expect(result).toStrictEqual({ ok: false, reason: `${name} must be set` });
			expect(JSON.stringify(result)).not.toContain("secret-key-value");
		},
	);
});

describe(buildProbeScripts, () => {
	const scripts = buildProbeScripts("run1");

	it("should produce the control, yielding, and busy scripts in experiment order", () => {
		expect.assertions(1);

		expect(scripts.map((script) => script.kind)).toStrictEqual(["control", "yielding", "busy"]);
	});

	it.for(scripts)(
		"should have the $kind script write its started marker to the run's sorted map",
		(script) => {
			expect.assertions(1);

			expect(script.source).toContain(
				'MemoryStoreService:GetSortedMap("bedrock-probe-run1")\n' +
					`map:SetAsync("${script.kind}-started", DateTime.now():ToIsoDate(), 3600)`,
			);
		},
	);

	it("should have the control write a finished marker and return", () => {
		expect.assertions(1);

		expect(scripts[0]!.source).toBe(
			[
				'local MemoryStoreService = game:GetService("MemoryStoreService")',
				'local map = MemoryStoreService:GetSortedMap("bedrock-probe-run1")',
				'map:SetAsync("control-started", DateTime.now():ToIsoDate(), 3600)',
				'map:SetAsync("control-finished", DateTime.now():ToIsoDate(), 3600)',
				'return "control"',
			].join("\n"),
		);
	});

	it("should have the yielding target wait forever and the busy target spin forever", () => {
		expect.assertions(2);

		expect(scripts[1]!.source.split("\n").slice(3)).toStrictEqual([
			"while true do",
			"\ttask.wait(1)",
			"end",
		]);
		expect(scripts[2]!.source.split("\n").slice(3)).toStrictEqual(["while true do", "end"]);
	});

	it.for(scripts)("should digest the $kind source with sha-256", (script) => {
		expect.assertions(1);

		expect(script.sha256).toBe(createHash("sha256").update(script.source).digest("hex"));
	});
});

describe(parseTaskPath, () => {
	it("should parse a version-pinned session task path", () => {
		expect.assertions(1);

		expect(
			parseTaskPath(
				"universes/111/places/222/versions/7/luau-execution-sessions/session-1/tasks/task-1",
			),
		).toStrictEqual({
			placeId: "222",
			sessionId: "session-1",
			taskId: "task-1",
			universeId: "111",
			versionId: "7",
		});
	});

	it.for([
		"universes/111/places/222/luau-execution-session-tasks/task-1",
		"universes/111/places/222/versions/7/luau-execution-session-tasks/task-1",
		"universes/111/places/222/luau-execution-sessions/session-1/tasks/task-1",
		"not a path",
	])("should reject %s because it cannot be polled without a version and session", (path) => {
		expect.assertions(1);

		expect(parseTaskPath(path)).toBeUndefined();
	});
});

describe(submitUrl, () => {
	it("should submit against the pinned version when one is known", () => {
		expect.assertions(1);

		expect(submitUrl({ placeId: "222", universeId: "111", versionId: "7" })).toBe(
			"https://apis.roblox.com/cloud/v2/universes/111/places/222/versions/7/luau-execution-session-tasks",
		);
	});

	it("should fall back to the head endpoint only while no version is known", () => {
		expect.assertions(1);

		expect(submitUrl({ placeId: "222", universeId: "111", versionId: undefined })).toBe(
			"https://apis.roblox.com/cloud/v2/universes/111/places/222/luau-execution-session-tasks",
		);
	});
});

describe(taskUrl, () => {
	it("should address the task through its session under the pinned version", () => {
		expect.assertions(1);

		expect(
			taskUrl({
				placeId: "222",
				sessionId: "session-1",
				taskId: "task-1",
				universeId: "111",
				versionId: "7",
			}),
		).toBe(
			"https://apis.roblox.com/cloud/v2/universes/111/places/222/versions/7/luau-execution-sessions/session-1/tasks/task-1",
		);
	});
});

describe(markerUrl, () => {
	it("should address a marker item inside the run's sorted map", () => {
		expect.assertions(1);

		expect(markerUrl({ itemId: "control-started", runId: "run1", universeId: "111" })).toBe(
			"https://apis.roblox.com/cloud/v2/universes/111/memory-store/sorted-maps/bedrock-probe-run1/items/control-started",
		);
	});
});

describe(captureHeaders, () => {
	it("should keep rate-limit, correlation, and gateway headers and drop the rest", () => {
		expect.assertions(1);

		const headers = new Headers({
			"content-type": "application/json",
			"date": "Sat, 20 Sep 2026 00:00:00 GMT",
			"retry-after": "5",
			"roblox-machine-id": "machine-a",
			"set-cookie": "secret=1",
			"x-envoy-ratelimited": "true",
			"x-ratelimit-limit": "5;w=60",
			"x-ratelimit-remaining": "4",
			"x-ratelimit-reset": "57",
			"x-request-id": "req-1",
		});

		expect(captureHeaders(headers)).toStrictEqual({
			"date": "Sat, 20 Sep 2026 00:00:00 GMT",
			"retry-after": "5",
			"roblox-machine-id": "machine-a",
			"x-envoy-ratelimited": "true",
			"x-ratelimit-limit": "5;w=60",
			"x-ratelimit-remaining": "4",
			"x-ratelimit-reset": "57",
			"x-request-id": "req-1",
		});
	});
});

describe(classifyObservation, () => {
	const observed = {
		errorCode: undefined,
		finalState: "PROCESSING",
		finishedSeen: false,
		kind: "yielding",
		markerReadFailure: undefined,
		startedSeen: true,
		submitted: true,
	} as const satisfies Observation;

	it("should flag a task that never reached a terminal state after its started marker was seen", () => {
		expect.assertions(1);

		expect(classifyObservation(observed)).toBe("RED_PROCESSING_AFTER_START");
	});

	it("should narrow to lost terminal publication when the finished marker was seen", () => {
		expect.assertions(1);

		expect(classifyObservation({ ...observed, finishedSeen: true, kind: "control" })).toBe(
			"LOST_TERMINAL_RESULT",
		);
	});

	it("should not claim a start it cannot prove", () => {
		expect.assertions(1);

		expect(classifyObservation({ ...observed, startedSeen: false })).toBe("START_UNPROVEN");
	});

	it("should blame the marker service when marker reads failed rather than missed", () => {
		expect.assertions(1);

		expect(
			classifyObservation({ ...observed, markerReadFailure: "HTTP 403", startedSeen: false }),
		).toBe("MARKER_SERVICE_FAILURE");
	});

	it.for(["QUEUED", "STATE_UNSPECIFIED", undefined])(
		"should treat %s as non-terminal",
		(state) => {
			expect.assertions(1);

			expect(classifyObservation({ ...observed, finalState: state })).toBe(
				"RED_PROCESSING_AFTER_START",
			);
		},
	);

	it.for(["yielding", "busy"] as const)(
		"should pass the %s target when it fails with DEADLINE_EXCEEDED after starting",
		(kind) => {
			expect.assertions(1);

			expect(
				classifyObservation({
					...observed,
					errorCode: "DEADLINE_EXCEEDED",
					finalState: "FAILED",
					kind,
				}),
			).toBe("PASS_DEADLINE_EXCEEDED");
		},
	);

	it("should pass the control when it completes with both markers", () => {
		expect.assertions(1);

		expect(
			classifyObservation({
				...observed,
				finalState: "COMPLETE",
				finishedSeen: true,
				kind: "control",
			}),
		).toBe("PASS_COMPLETE");
	});

	it("should pass the bootstrap task on completion without any marker", () => {
		expect.assertions(1);

		expect(
			classifyObservation({
				...observed,
				finalState: "COMPLETE",
				kind: "bootstrap",
				startedSeen: false,
			}),
		).toBe("PASS_COMPLETE");
	});

	it("should flag the expected terminal state when the markers never appeared", () => {
		expect.assertions(2);

		expect(
			classifyObservation({
				...observed,
				errorCode: "DEADLINE_EXCEEDED",
				finalState: "FAILED",
				startedSeen: false,
			}),
		).toBe("MARKER_UNOBSERVED");
		expect(classifyObservation({ ...observed, finalState: "COMPLETE", kind: "control" })).toBe(
			"MARKER_UNOBSERVED",
		);
	});

	it.for([
		{ errorCode: undefined, finalState: "COMPLETE", kind: "yielding" },
		{ errorCode: undefined, finalState: "CANCELLED", kind: "yielding" },
		{ errorCode: "INTERNAL_ERROR", finalState: "FAILED", kind: "busy" },
		{ errorCode: "SCRIPT_ERROR", finalState: "FAILED", kind: "control" },
	] as const)("should flag $finalState/$errorCode on $kind as unexpected", (terminal) => {
		expect.assertions(1);

		expect(classifyObservation({ ...observed, ...terminal })).toBe("UNEXPECTED_TERMINAL");
	});

	it("should report a rejected submit ahead of any state", () => {
		expect.assertions(1);

		expect(classifyObservation({ ...observed, finalState: undefined, submitted: false })).toBe(
			"SUBMIT_REJECTED",
		);
	});
});

describe(summarizeVerdicts, () => {
	it("should be green only when the control, yielding, and busy targets all passed", () => {
		expect.assertions(1);

		expect(
			summarizeVerdicts([
				{ kind: "bootstrap", verdict: "PASS_COMPLETE" },
				{ kind: "control", verdict: "PASS_COMPLETE" },
				{ kind: "yielding", verdict: "PASS_DEADLINE_EXCEEDED" },
				{ kind: "busy", verdict: "PASS_DEADLINE_EXCEEDED" },
			]),
		).toBe("GREEN");
	});

	it.for(["RED_PROCESSING_AFTER_START", "LOST_TERMINAL_RESULT"] as const)(
		"should be red on %s",
		(verdict) => {
			expect.assertions(1);

			expect(
				summarizeVerdicts([
					{ kind: "control", verdict: "PASS_COMPLETE" },
					{ kind: "yielding", verdict },
				]),
			).toBe("RED");
		},
	);

	it("should be inconclusive when the run stopped before the busy target passed", () => {
		expect.assertions(2);

		expect(
			summarizeVerdicts([
				{ kind: "control", verdict: "PASS_COMPLETE" },
				{ kind: "yielding", verdict: "START_UNPROVEN" },
			]),
		).toBe("INCONCLUSIVE");
		expect(
			summarizeVerdicts([
				{ kind: "control", verdict: "PASS_COMPLETE" },
				{ kind: "yielding", verdict: "PASS_DEADLINE_EXCEEDED" },
			]),
		).toBe("INCONCLUSIVE");
	});
});

interface FakeStage {
	/** `error.code` reported once the state is FAILED. */
	readonly errorCode?: string;
	/**
	 * Marker item ids the "script" has written, e.g. `["started",
	 * "finished"]`.
	 */
	readonly markers?: ReadonlyArray<string>;
	/** Status every marker read returns instead of 200/404. */
	readonly markerStatus?: number;
	/** Task reads that reject with a transport error (1-based poll numbers). */
	readonly pollTransportErrors?: ReadonlyArray<number>;
	/** Successive `state` values; the last one repeats forever. */
	readonly states: ReadonlyArray<string>;
	/** Status the submit returns when not 200. */
	readonly submitStatus?: number;
}

interface FakeCall {
	readonly body: string | undefined;
	readonly method: string;
	readonly url: string;
}

interface FakeCloud {
	readonly calls: Array<FakeCall>;
	readonly deps: ProbeDeps;
	readonly records: Array<ProbeRecord>;
}

const FAKE_HEADERS = { "x-ratelimit-remaining": "4", "x-request-id": "req-1" };
const FAKE_START = Date.UTC(2026, 8, 20, 12, 0, 0);
const FAKE_CONFIG: ProbeConfig = {
	apiKey: "secret-key-value",
	observationBoundMs: 60_000,
	placeId: "222",
	placeVersionId: undefined,
	pollIntervalMs: 1000,
	timeoutSeconds: 5,
	universeId: "111",
};

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { headers: FAKE_HEADERS, status });
}

function headersOf(init: RequestInit): Headers {
	return new Headers(init.headers);
}

function stageKindOf(submitBody: string): StageKind {
	if (submitBody.includes('"script":"return 0"')) {
		return "bootstrap";
	}

	if (submitBody.includes("busy-started")) {
		return "busy";
	}

	return submitBody.includes("yielding-started") ? "yielding" : "control";
}

function toStageKind(name: string): StageKind {
	switch (name) {
		case "bootstrap":
		case "busy":
		case "control":
		case "yielding": {
			return name;
		}
		default: {
			throw new Error(`unexpected stage ${name}`);
		}
	}
}

function makeFakeCloud(stages: Partial<Record<StageKind, FakeStage>>): FakeCloud {
	const calls: Array<FakeCall> = [];
	const records: Array<ProbeRecord> = [];
	const polls = new Map<StageKind, number>();
	let clock = FAKE_START;

	function respondSubmit(body: string | undefined): Response {
		const kind = stageKindOf(body ?? "");
		const stage = stages[kind];
		if (stage?.submitStatus !== undefined) {
			return json(stage.submitStatus, { errors: [{ code: 0, message: "" }] });
		}

		return json(200, {
			path: `universes/111/places/222/versions/7/luau-execution-sessions/s-${kind}/tasks/t-${kind}`,
			state: "QUEUED",
			timeout: "5s",
			user: "12345",
		});
	}

	function respondTask(kind: StageKind): Response {
		const stage = stages[kind];
		const poll = (polls.get(kind) ?? 0) + 1;
		polls.set(kind, poll);
		if (stage?.pollTransportErrors?.includes(poll) === true) {
			throw new TypeError("fetch failed");
		}

		const states = stage?.states ?? ["PROCESSING"];
		const state = states[Math.min(poll, states.length) - 1] ?? "PROCESSING";
		const error = state === "FAILED" ? { code: stage?.errorCode, message: "boom" } : undefined;
		return json(200, { error, path: `tasks/t-${kind}`, state, user: "12345" });
	}

	function respondMarker(kind: StageKind, marker: string): Response {
		const stage = stages[kind];
		if (stage?.markerStatus !== undefined) {
			return json(stage.markerStatus, { errors: [] });
		}

		return stage?.markers?.includes(marker) === true
			? json(200, { id: `${kind}-${marker}`, value: "2026-09-20T12:00:01Z" })
			: json(404, { code: "NOT_FOUND", message: "missing" });
	}

	function respond(url: string, init: RequestInit): Response {
		const method = init.method ?? "GET";
		const body = typeof init.body === "string" ? init.body : undefined;
		calls.push({ body, method, url });
		if (method === "POST") {
			return respondSubmit(body);
		}

		const task = /\/tasks\/t-(\w+)$/.exec(url);
		if (task !== null) {
			return respondTask(toStageKind(task[1] ?? ""));
		}

		const marker = /\/items\/(\w+)-(\w+)$/.exec(url);
		if (marker !== null) {
			return respondMarker(toStageKind(marker[1] ?? ""), marker[2] ?? "");
		}

		throw new Error(`unexpected ${method} ${url}`);
	}

	return {
		calls,
		deps: {
			emit: (record) => {
				records.push(record);
			},
			fetch: async (url, init) => respond(url, init),
			now: () => new Date(clock),
			sleepAsync: async (ms) => {
				clock += ms;
			},
		},
		records,
	};
}

const GREEN_LADDER: Partial<Record<StageKind, FakeStage>> = {
	bootstrap: { states: ["QUEUED", "COMPLETE"] },
	busy: {
		errorCode: "DEADLINE_EXCEEDED",
		markers: ["started"],
		states: ["PROCESSING", "FAILED"],
	},
	control: { markers: ["started", "finished"], states: ["PROCESSING", "COMPLETE"] },
	yielding: {
		errorCode: "DEADLINE_EXCEEDED",
		markers: ["started"],
		states: ["PROCESSING", "PROCESSING", "FAILED"],
	},
};

describe(runProbeAsync, () => {
	it("should walk the full ladder to green when every stage reaches its documented terminal state", async () => {
		expect.assertions(2);

		const cloud = makeFakeCloud(GREEN_LADDER);
		const summary = await runProbeAsync({
			config: FAKE_CONFIG,
			deps: cloud.deps,
			runId: "run1",
		});

		expect(summary).toMatchObject({ colour: "GREEN", placeVersionId: "7", runId: "run1" });
		expect(
			summary.stages.map(({ kind, polls, verdict }) => {
				return { kind, polls, verdict };
			}),
		).toStrictEqual([
			{ kind: "bootstrap", polls: 2, verdict: "PASS_COMPLETE" },
			{ kind: "control", polls: 2, verdict: "PASS_COMPLETE" },
			{ kind: "yielding", polls: 3, verdict: "PASS_DEADLINE_EXCEEDED" },
			{ kind: "busy", polls: 2, verdict: "PASS_DEADLINE_EXCEEDED" },
		]);
	});

	it("should bootstrap the version at head and pin every experiment task to it", async () => {
		expect.assertions(1);

		const cloud = makeFakeCloud(GREEN_LADDER);
		await runProbeAsync({ config: FAKE_CONFIG, deps: cloud.deps, runId: "run1" });

		expect(
			cloud.calls.filter((call) => call.method === "POST").map((call) => call.url),
		).toStrictEqual([
			"https://apis.roblox.com/cloud/v2/universes/111/places/222/luau-execution-session-tasks",
			"https://apis.roblox.com/cloud/v2/universes/111/places/222/versions/7/luau-execution-session-tasks",
			"https://apis.roblox.com/cloud/v2/universes/111/places/222/versions/7/luau-execution-session-tasks",
			"https://apis.roblox.com/cloud/v2/universes/111/places/222/versions/7/luau-execution-session-tasks",
		]);
	});

	it("should skip the bootstrap when a version is supplied", async () => {
		expect.assertions(2);

		const cloud = makeFakeCloud(GREEN_LADDER);
		const summary = await runProbeAsync({
			config: { ...FAKE_CONFIG, placeVersionId: "7" },
			deps: cloud.deps,
			runId: "run1",
		});

		expect(summary.stages.map(({ kind }) => kind)).toStrictEqual([
			"control",
			"yielding",
			"busy",
		]);
		expect(cloud.calls[0]!.url).toContain("/versions/7/");
	});

	it("should request the 5 second timeout with the exact script and never retry a request", async () => {
		expect.assertions(2);

		const cloud = makeFakeCloud(GREEN_LADDER);
		await runProbeAsync({ config: FAKE_CONFIG, deps: cloud.deps, runId: "run1" });
		const [control] = buildProbeScripts("run1");
		const submits = cloud.calls.filter((call) => call.method === "POST");

		expect(submits[1]!.body).toBe(JSON.stringify({ script: control!.source, timeout: "5s" }));
		expect(submits).toHaveLength(4);
	});

	it("should stop at a confirmed-start task that outlives the bound and never submit the next stage", async () => {
		expect.assertions(4);

		const cloud = makeFakeCloud({
			...GREEN_LADDER,
			yielding: { markers: ["started"], states: ["PROCESSING"] },
		});
		const summary = await runProbeAsync({
			config: FAKE_CONFIG,
			deps: cloud.deps,
			runId: "run1",
		});
		const yielding = summary.stages.at(-1);

		expect(summary.colour).toBe("RED");
		expect(yielding).toMatchObject({
			kind: "yielding",
			polls: 60,
			taskPath:
				"universes/111/places/222/versions/7/luau-execution-sessions/s-yielding/tasks/t-yielding",
			verdict: "RED_PROCESSING_AFTER_START",
		});
		expect(summary.stages.map(({ kind }) => kind)).not.toContain("busy");

		const times = cloud.records
			.filter((record) => record.stage === "yielding")
			.map((record) => Date.parse(record.at));

		expect(Math.max(...times) - Math.min(...times)).toBe(60_000);
	});

	it("should read the started marker only until it is seen", async () => {
		expect.assertions(1);

		const cloud = makeFakeCloud({
			...GREEN_LADDER,
			yielding: { markers: ["started"], states: ["PROCESSING"] },
		});
		await runProbeAsync({ config: FAKE_CONFIG, deps: cloud.deps, runId: "run1" });

		expect(
			cloud.calls.filter((call) => call.url.endsWith("/items/yielding-started")),
		).toHaveLength(1);
	});

	it("should stop after a rejected submit without polling anything", async () => {
		expect.assertions(2);

		const cloud = makeFakeCloud({
			...GREEN_LADDER,
			control: { states: [], submitStatus: 429 },
		});
		const summary = await runProbeAsync({
			config: FAKE_CONFIG,
			deps: cloud.deps,
			runId: "run1",
		});

		expect(
			summary.stages.map(({ kind, polls, verdict }) => {
				return { kind, polls, verdict };
			}),
		).toStrictEqual([
			{ kind: "bootstrap", polls: 2, verdict: "PASS_COMPLETE" },
			{ kind: "control", polls: 0, verdict: "SUBMIT_REJECTED" },
		]);
		expect(summary.colour).toBe("INCONCLUSIVE");
	});

	it("should stop when the bootstrap submit fails and leave the version unresolved", async () => {
		expect.assertions(1);

		const cloud = makeFakeCloud({ bootstrap: { states: [], submitStatus: 500 } });
		const summary = await runProbeAsync({
			config: FAKE_CONFIG,
			deps: cloud.deps,
			runId: "run1",
		});

		expect(summary).toMatchObject({
			colour: "INCONCLUSIVE",
			placeVersionId: undefined,
			stages: [{ kind: "bootstrap", verdict: "SUBMIT_REJECTED" }],
		});
	});

	it("should record a transport failure on a poll and keep the cadence", async () => {
		expect.assertions(2);

		const cloud = makeFakeCloud({
			...GREEN_LADDER,
			control: {
				markers: ["started", "finished"],
				pollTransportErrors: [1],
				states: ["PROCESSING", "COMPLETE"],
			},
		});
		const summary = await runProbeAsync({
			config: FAKE_CONFIG,
			deps: cloud.deps,
			runId: "run1",
		});

		expect(summary.stages[1]).toMatchObject({
			kind: "control",
			polls: 2,
			verdict: "PASS_COMPLETE",
		});
		expect(
			cloud.records.filter((record) => record.event === "task-transport-error"),
		).toMatchObject([{ detail: { message: "TypeError: fetch failed" }, stage: "control" }]);
	});

	it("should treat a failing marker service as unproven rather than red", async () => {
		expect.assertions(1);

		const cloud = makeFakeCloud({
			...GREEN_LADDER,
			control: { markerStatus: 403, states: ["PROCESSING"] },
		});
		const summary = await runProbeAsync({
			config: FAKE_CONFIG,
			deps: cloud.deps,
			runId: "run1",
		});

		expect(summary.stages[1]!.verdict).toBe("MARKER_SERVICE_FAILURE");
	});

	it("should emit submit, task, marker, verdict, and summary records without the api key", async () => {
		expect.assertions(3);

		const cloud = makeFakeCloud({
			...GREEN_LADDER,
			control: { markers: ["started", "finished"], states: ["COMPLETE"] },
		});
		await runProbeAsync({
			config: { ...FAKE_CONFIG, placeVersionId: "7" },
			deps: cloud.deps,
			runId: "run1",
		});
		const control = cloud.records.filter((record) => record.stage === "control");

		expect(control.map((record) => record.event)).toStrictEqual([
			"submit",
			"task",
			"marker",
			"marker",
			"verdict",
		]);
		expect(control[2]).toStrictEqual({
			at: "2026-09-20T12:00:00.000Z",
			detail: {
				body: '{"id":"control-started","value":"2026-09-20T12:00:01Z"}',
				headers: FAKE_HEADERS,
				marker: "started",
				status: 200,
				value: "2026-09-20T12:00:01Z",
			},
			event: "marker",
			runId: "run1",
			stage: "control",
		});
		expect(JSON.stringify(cloud.records)).not.toContain("secret-key-value");
	});

	it("should send the api key header and a per-request abort signal on every call", async () => {
		expect.assertions(1);

		const seen: Array<RequestInit> = [];
		const cloud = makeFakeCloud(GREEN_LADDER);
		async function spyFetch(url: string, init: RequestInit): Promise<Response> {
			seen.push(init);
			return cloud.deps.fetch(url, init);
		}

		await runProbeAsync({
			config: FAKE_CONFIG,
			deps: { ...cloud.deps, fetch: spyFetch },
			runId: "run1",
		});
		const projection = seen.map((init) => {
			return {
				key: headersOf(init).get("x-api-key"),
				hasSignal: init.signal instanceof AbortSignal,
			};
		});

		expect(projection).toStrictEqual(
			projection.map(() => ({ key: "secret-key-value", hasSignal: true })),
		);
	});
});

describe(redactRecord, () => {
	const taskPath =
		"universes/111/places/222/versions/7/luau-execution-sessions/abc-session/tasks/xyz-task";
	const record: ProbeRecord = {
		at: "2026-09-20T12:00:00.000Z",
		detail: {
			body: `{"path":"${taskPath}","state":"PROCESSING","user":"12345"}`,
			observation: { startedSeen: true, taskPath },
			polls: 3,
			taskPath,
		},
		event: "verdict",
		runId: "run1",
		stage: "yielding",
	};

	it("should replace session and task ids with stable pseudonyms wherever they appear", () => {
		expect.assertions(2);

		const redacted = redactRecord(record);
		const pseudonym = `universes/111/places/222/versions/7/luau-execution-sessions/session-${sha256Hex("abc-session").slice(0, 8)}/tasks/task-${sha256Hex("xyz-task").slice(0, 8)}`;

		expect(redacted.detail["taskPath"]).toBe(pseudonym);
		expect(redacted.detail["observation"]).toStrictEqual({
			startedSeen: true,
			taskPath: pseudonym,
		});
	});

	it("should scrub the key owner's user id from response bodies", () => {
		expect.assertions(2);

		const body = String(redactRecord(record).detail["body"]);

		expect(body).toContain('"user":"<redacted>"');
		expect(body).not.toContain("12345");
	});

	it("should leave non-string values and the envelope untouched", () => {
		expect.assertions(1);

		expect(redactRecord(record)).toMatchObject({
			at: "2026-09-20T12:00:00.000Z",
			detail: { polls: 3 },
			event: "verdict",
			runId: "run1",
			stage: "yielding",
		});
	});
});

describe(toJsonl, () => {
	it("should write one JSON object per line with a trailing newline", () => {
		expect.assertions(1);

		const record: ProbeRecord = {
			at: "t",
			detail: { status: 200 },
			event: "task",
			runId: "run1",
			stage: "control",
		};

		expect(toJsonl([record, record])).toBe(
			'{"at":"t","detail":{"status":200},"event":"task","runId":"run1","stage":"control"}\n'.repeat(
				2,
			),
		);
	});
});
