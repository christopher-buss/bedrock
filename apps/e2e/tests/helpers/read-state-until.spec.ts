import type { BedrockState, StateError, StatePort } from "@bedrock-rbx/core";
import type { Result } from "@bedrock-rbx/ocale";

import { describe, expect, it, onTestFinished, vi } from "vitest";

import { readStateUntil } from "./read-state-until.ts";

type ReadResult = Result<BedrockState | undefined, StateError>;

interface FakeStatePort {
	readonly reads: Array<string>;
	readonly statePort: Pick<StatePort, "read">;
}

interface FakeSleep {
	readonly calls: Array<number>;
	readonly sleep: (ms: number) => Promise<void>;
}

function fakeReadSequence(responses: ReadonlyArray<ReadResult>): FakeStatePort {
	const reads: Array<string> = [];
	let index = 0;
	async function read(environment: string): Promise<ReadResult> {
		reads.push(environment);
		const response = responses[index];
		if (response === undefined) {
			throw new Error(`fakeReadSequence: no response queued for read ${String(index + 1)}`);
		}

		index += 1;
		return response;
	}

	return { reads, statePort: { read } };
}

function fakeSleep(): FakeSleep {
	const calls: Array<number> = [];
	async function sleep(ms: number): Promise<void> {
		calls.push(ms);
	}

	return { calls, sleep };
}

function stateFor(environment: string): BedrockState {
	return { environment, resources: [], version: 1 };
}

function okResult(environment: string): ReadResult {
	return { data: stateFor(environment), success: true };
}

const ENVIRONMENT = "smoke";
const READY = "ready";
const PENDING = "pending";
function isReady(state: BedrockState): boolean {
	return state.environment === READY;
}

describe(readStateUntil, () => {
	it("should return the first read when it already satisfies the predicate", async () => {
		expect.assertions(3);

		const { reads, statePort } = fakeReadSequence([okResult(READY)]);
		const sleepFake = fakeSleep();

		const result = await readStateUntil({
			environment: ENVIRONMENT,
			predicate: isReady,
			sleep: sleepFake.sleep,
			statePort,
		});

		expect(reads).toStrictEqual([ENVIRONMENT]);
		expect(sleepFake.calls).toBeEmpty();
		expect(result).toStrictEqual(okResult(READY));
	});

	it("should poll until the predicate holds, sleeping with exponential backoff", async () => {
		expect.assertions(3);

		const { reads, statePort } = fakeReadSequence([
			okResult(PENDING),
			okResult(PENDING),
			okResult(READY),
		]);
		const sleepFake = fakeSleep();

		const result = await readStateUntil({
			baseDelayMs: 250,
			environment: ENVIRONMENT,
			predicate: isReady,
			sleep: sleepFake.sleep,
			statePort,
		});

		expect(reads).toHaveLength(3);
		expect(sleepFake.calls).toStrictEqual([250, 500]);
		expect(result).toStrictEqual(okResult(READY));
	});

	it("should stop after the attempt budget and return the last stale read", async () => {
		expect.assertions(3);

		const { reads, statePort } = fakeReadSequence([
			okResult(PENDING),
			okResult(PENDING),
			okResult(PENDING),
		]);
		const sleepFake = fakeSleep();

		const result = await readStateUntil({
			attempts: 3,
			baseDelayMs: 250,
			environment: ENVIRONMENT,
			predicate: isReady,
			sleep: sleepFake.sleep,
			statePort,
		});

		expect(reads).toHaveLength(3);
		expect(sleepFake.calls).toStrictEqual([250, 500]);
		expect(result).toStrictEqual(okResult(PENDING));
	});

	it("should treat an absent state file as not yet converged and keep polling", async () => {
		expect.assertions(3);

		const { reads, statePort } = fakeReadSequence([
			{ data: undefined, success: true },
			okResult(READY),
		]);
		const sleepFake = fakeSleep();

		const result = await readStateUntil({
			baseDelayMs: 250,
			environment: ENVIRONMENT,
			predicate: isReady,
			sleep: sleepFake.sleep,
			statePort,
		});

		expect(reads).toHaveLength(2);
		expect(sleepFake.calls).toStrictEqual([250]);
		expect(result).toStrictEqual(okResult(READY));
	});

	it("should treat a failed read as not yet converged and return the last failure", async () => {
		expect.assertions(3);

		const failure: ReadResult = {
			err: {
				file: "gist:abc/state.smoke.json",
				kind: "stateError",
				reason: "github returned 403",
			},
			success: false,
		};
		const { reads, statePort } = fakeReadSequence([failure, failure, failure]);
		const sleepFake = fakeSleep();

		const result = await readStateUntil({
			attempts: 3,
			baseDelayMs: 250,
			environment: ENVIRONMENT,
			predicate: isReady,
			sleep: sleepFake.sleep,
			statePort,
		});

		expect(reads).toHaveLength(3);
		expect(sleepFake.calls).toStrictEqual([250, 500]);
		expect(result).toStrictEqual(failure);
	});

	it("should fall back to a real timer when no sleep seam is injected", async () => {
		expect.assertions(2);

		vi.useFakeTimers();
		onTestFinished(() => {
			vi.useRealTimers();
		});

		const { reads, statePort } = fakeReadSequence([okResult(PENDING), okResult(READY)]);

		const pending = readStateUntil({
			baseDelayMs: 10,
			environment: ENVIRONMENT,
			predicate: isReady,
			statePort,
		});
		await vi.runAllTimersAsync();
		const result = await pending;

		expect(reads).toHaveLength(2);
		expect(result).toStrictEqual(okResult(READY));
	});
});
