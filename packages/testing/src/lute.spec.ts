import { fromPartial } from "@total-typescript/shoehorn";

import type { SpawnSyncReturns } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

import { detectLute, reportLute } from "./lute.ts";

interface FakeResultOverrides {
	readonly error?: Error;
	readonly signal?: NodeJS.Signals;
	readonly status?: number;
	readonly stdout?: string;
}

function fakeResult(overrides: FakeResultOverrides): SpawnSyncReturns<string> {
	// A missing `status` leaves it absent (read as "not a number"), which is how
	// detectLute distinguishes a signal kill from a real exit code. `null` for
	// the absent fields is banned under src, so the partial is cast to the wire
	// shape.
	return fromPartial({
		output: [],
		pid: 1,
		stderr: "",
		stdout: "",
		...overrides,
	});
}

function spawnReturning(
	result: SpawnSyncReturns<string>,
): typeof import("node:child_process").spawnSync {
	return fromPartial(() => result);
}

describe(detectLute, () => {
	it("should report a usable lute when the version meets the minimum", () => {
		expect.assertions(1);

		const detection = detectLute(
			spawnReturning(fakeResult({ status: 0, stdout: "1.0.0\n" })),
			{},
		);

		expect(detection).toStrictEqual({ available: true });
	});

	it("should skip silently when the binary cannot be spawned", () => {
		expect.assertions(1);

		const error = Object.assign(new Error("spawn lute ENOENT"), { code: "ENOENT" });
		const detection = detectLute(spawnReturning(fakeResult({ error })), {});

		expect(detection).toStrictEqual({ available: false });
	});

	it("should surface a reason when the version probe times out", () => {
		expect.assertions(2);

		const error = Object.assign(new Error("spawnSync lute ETIMEDOUT"), { code: "ETIMEDOUT" });
		const detection = detectLute(spawnReturning(fakeResult({ error })), {});

		expect(detection.available).toBeFalse();
		expect(detection.reason).toBe('lute "lute --version" timed out after 5000ms');
	});

	it("should skip silently for an older-but-valid version", () => {
		expect.assertions(1);

		const detection = detectLute(
			spawnReturning(fakeResult({ status: 0, stdout: "0.1.5\n" })),
			{},
		);

		expect(detection).toStrictEqual({ available: false });
	});

	it("should surface a reason when a present lute exits non-zero", () => {
		expect.assertions(2);

		const detection = detectLute(spawnReturning(fakeResult({ status: 3 })), {});

		expect(detection.available).toBeFalse();
		expect(detection.reason).toBe('lute "lute --version" exited with status 3');
	});

	it("should surface a reason when a present lute is killed by a signal", () => {
		expect.assertions(2);

		const detection = detectLute(spawnReturning(fakeResult({ signal: "SIGSEGV" })), {});

		expect(detection.available).toBeFalse();
		expect(detection.reason).toBe('lute "lute --version" was killed by signal SIGSEGV');
	});

	it("should fall back to an unknown signal when none is reported", () => {
		expect.assertions(1);

		const detection = detectLute(spawnReturning(fakeResult({})), {});

		expect(detection.reason).toBe('lute "lute --version" was killed by signal unknown');
	});

	it("should surface a reason when the version string cannot be parsed", () => {
		expect.assertions(2);

		const detection = detectLute(
			spawnReturning(fakeResult({ status: 0, stdout: "lute version 1.0.0\n" })),
			{},
		);

		expect(detection.available).toBeFalse();
		expect(detection.reason).toBe(
			'lute reported an unrecognized version: "lute version 1.0.0"',
		);
	});

	it("should prefer a non-empty BEDROCK_LUTE_PATH override in the reason", () => {
		expect.assertions(1);

		const detection = detectLute(spawnReturning(fakeResult({ status: 3 })), {
			BEDROCK_LUTE_PATH: "/opt/lute",
		});

		expect(detection.reason).toBe('lute "/opt/lute --version" exited with status 3');
	});

	it("should treat an empty BEDROCK_LUTE_PATH as unset and fall back to lute", () => {
		expect.assertions(1);

		const detection = detectLute(spawnReturning(fakeResult({ status: 3 })), {
			BEDROCK_LUTE_PATH: "",
		});

		expect(detection.reason).toBe('lute "lute --version" exited with status 3');
	});
});

describe(reportLute, () => {
	it("should warn with the reason for an unusable-but-present lute", () => {
		expect.assertions(2);

		const warn = vi.fn<(message: string) => void>();
		const isAvailable = reportLute({ available: false, reason: "lute is broken" }, warn);

		expect(isAvailable).toBeFalse();
		expect(warn).toHaveBeenCalledExactlyOnceWith("[bedrock] lute is broken");
	});

	it("should not warn when there is no reason", () => {
		expect.assertions(2);

		const warn = vi.fn<(message: string) => void>();
		const isAvailable = reportLute({ available: true }, warn);

		expect(isAvailable).toBeTrue();
		expect(warn).not.toHaveBeenCalled();
	});
});
