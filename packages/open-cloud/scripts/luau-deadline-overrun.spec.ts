import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
	buildProbeScripts,
	captureHeaders,
	classifyObservation,
	markerUrl,
	parseTaskPath,
	resolveProbeConfig,
	submitUrl,
	summarizeVerdicts,
	taskUrl,
} from "./luau-deadline-overrun.ts";
import type { Observation } from "./luau-deadline-overrun.ts";

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
