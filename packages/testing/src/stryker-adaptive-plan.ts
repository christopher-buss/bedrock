import type { LeaseReport, LeaseRequest, TreePeaks } from "@isentinel/machine-budget";

/** Stryker needs one checker and one test runner to make progress. */
export const MINIMUM_STRYKER_WORKERS = 2;

/** The cost of one worker until the budget has learned a real one. */
const INITIAL_WORKER_MEMORY = 1024 * 1024 * 1024;

const BYTES_PER_MIB = 1024 * 1024;

const SET_CAPACITY_TYPE = "stryker:set-capacity";
const CAPACITY_APPLIED_TYPE = "stryker:capacity-applied";

/** The resize message the patched Stryker reads from its IPC channel. */
export interface SetCapacityMessage {
	/** The total workers, checkers and test runners together. */
	readonly capacity: number;
	/** Marks the message as a resize request. */
	readonly type: typeof SET_CAPACITY_TYPE;
}

/**
 * The most workers one Stryker run may hold: the Stryker default of one
 * less than the logical cores, but never below a checker and a test runner.
 *
 * @param parallelism - Logical cores, as `os.availableParallelism()` reports.
 * @returns The worker ceiling for the run.
 */
export function maxStrykerWorkers(parallelism: number): number {
	return Math.max(MINIMUM_STRYKER_WORKERS, parallelism - 1);
}

/**
 * The lease one Stryker run asks the machine budget for.
 *
 * @param options - The cores of the machine and the project the cost is
 *   learned for.
 * @param options.parallelism - Logical cores of the machine.
 * @param options.project - Names the learned cost, such as `packages/actions`.
 * @returns What to pass to `leaseAsync` and `tryLease`.
 */
export function buildStrykerLeaseRequest(options: {
	parallelism: number;
	project: string;
}): LeaseRequest {
	return {
		cost: { pass: "stryker", project: options.project },
		isMainLaneOnly: true,
		maxWorkers: maxStrykerWorkers(options.parallelism),
		memoryPerWorker: INITIAL_WORKER_MEMORY,
		minWorkers: MINIMUM_STRYKER_WORKERS,
	};
}

/**
 * How many more workers a running Stryker should lease.
 *
 * @param options - The current state of the run.
 * @param options.cap - The workers the run cap lets this run hold.
 * @param options.held - The workers the run holds now.
 * @param options.max - The worker ceiling of the run.
 * @returns The workers to lease, zero when the run is at its limit.
 */
export function workersToGrow(options: { cap: number; held: number; max: number }): number {
	return Math.max(0, Math.min(options.cap, options.max) - options.held);
}

/**
 * The report a released lease records, from the peaks of the Stryker tree.
 *
 * @param peaks - The peaks the tree watch read.
 * @returns The report, or undefined when the platform read no tree peak.
 */
export function buildLeaseReport(peaks: TreePeaks): LeaseReport | undefined {
	if (peaks.peakMemory === undefined) {
		return undefined;
	}

	return peaks.peakPerWorker === undefined
		? { peakMemory: peaks.peakMemory }
		: { peakMemory: peaks.peakMemory, peakPerWorker: peaks.peakPerWorker };
}

/**
 * Describes the peaks a run reports, for the progress log.
 *
 * @param report - The report a released lease records.
 * @returns The peaks in MiB, such as `peak 3000 MiB, 900 MiB per worker`.
 */
export function describePeaks(report: LeaseReport): string {
	const perWorker =
		report.peakPerWorker === undefined
			? "unknown"
			: `${String(Math.round(report.peakPerWorker / BYTES_PER_MIB))} MiB`;
	return `peak ${String(Math.round(report.peakMemory / BYTES_PER_MIB))} MiB, ${perWorker} per worker`;
}

/**
 * The message that sets the total worker capacity of a running Stryker.
 *
 * @param capacity - The total workers, checkers and test runners together.
 * @returns The IPC message.
 */
export function setCapacityMessage(capacity: number): SetCapacityMessage {
	return { capacity, type: SET_CAPACITY_TYPE };
}

/**
 * Reads the capacity a running Stryker reports it has applied.
 *
 * @param message - A message from the Stryker IPC channel.
 * @returns The applied capacity, or undefined for any other message.
 */
export function parseCapacityApplied(message: unknown): number | undefined {
	if (typeof message !== "object" || message === null) {
		return undefined;
	}

	if (!("type" in message) || message.type !== CAPACITY_APPLIED_TYPE) {
		return undefined;
	}

	return "capacity" in message && typeof message.capacity === "number"
		? message.capacity
		: undefined;
}
