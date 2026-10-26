import type {
	Lease,
	LeaseReport,
	LeaseRequest,
	MachineBudget,
	TreeWatch,
} from "@isentinel/machine-budget";
import { openMachineBudget, watchTree } from "@isentinel/machine-budget";

import { availableParallelism } from "node:os";
import { relative } from "node:path";
import process from "node:process";

import {
	buildLeaseReport,
	buildStrykerLeaseRequest,
	describePeaks,
	parseCapacityApplied,
	setCapacityMessage,
	workersToGrow,
} from "./stryker-adaptive-plan.ts";
import type { SetCapacityMessage } from "./stryker-adaptive-plan.ts";
import { spawnStryker } from "./stryker-bun.ts";

/** The parts of a spawned Stryker process the adaptive runner uses. */
export interface StrykerChild {
	/** Fires when the process could not start or the IPC send failed. */
	on(event: "error", listener: (error: Error) => void): unknown;
	/** Fires once the process ends, with no code when a signal ended it. */
	on(event: "exit", listener: (code: null | number) => void): unknown;
	/** Fires for each IPC message from Stryker. */
	on(event: "message", listener: (message: unknown) => void): unknown;
	/** The process id, absent when the process could not start. */
	readonly pid?: number | undefined;
	/** Sends one IPC message; the callback takes a closed-channel error. */
	send(message: SetCapacityMessage, callback: (error: Error | null) => void): boolean;
}

/** What one adaptive Stryker run needs from its surroundings. */
export interface AdaptiveStrykerOptions {
	/** The machine budget the run leases its workers from. */
	readonly budget: MachineBudget;
	/** Prints one progress line, such as `console.error`. */
	readonly log: (line: string) => void;
	/** Logical cores of the machine. */
	readonly parallelism: number;
	/** Names the learned cost, such as `packages/actions`. */
	readonly project: string;
	/** Calls the tick until the returned cancel runs. */
	readonly schedule: (tick: () => void) => () => void;
	/** Starts Stryker with these extra environment variables. */
	readonly spawn: (environment: Record<string, string>) => StrykerChild;
	/** Watches the peaks of the Stryker process tree. */
	readonly watchTree: (pid: number) => TreeWatch;
}

const ADAPTIVE_CAPACITY_ENV = "STRYKER_ADAPTIVE_INITIAL_CAPACITY";
const GROW_INTERVAL_MS = 1000;

interface StrykerRun {
	readonly leases: Array<Lease>;
	readonly options: AdaptiveStrykerOptions;
	readonly request: LeaseRequest;
}

interface RunningStryker extends StrykerRun {
	readonly child: StrykerChild;
}

/**
 * Runs one Stryker process on workers leased from the machine budget. It
 * starts with the first lease, grows while the run cap allows and tells
 * Stryker each new capacity over IPC. On exit it gives every lease back and
 * records the tree peaks once, on the first lease, so one run adds one
 * learned sample.
 *
 * @param options - The budget, the process launcher and the tree watch.
 * @returns The Stryker exit status, or undefined when it did not exit normally.
 */
export async function runAdaptiveStrykerAsync(
	options: AdaptiveStrykerOptions,
): Promise<number | undefined> {
	const request = buildStrykerLeaseRequest(options);
	const first = await options.budget.leaseAsync(request);
	const leases = [first];
	let report: LeaseReport | undefined;
	try {
		const outcome = await superviseAsync({ leases, options, request });
		({ report } = outcome);
		return outcome.status;
	} finally {
		first.release(report);
		for (const lease of leases.slice(1)) {
			lease.release();
		}
	}
}

/**
 * Calls a tick on a fixed interval that does not keep the process alive.
 *
 * @param tick - The function to call.
 * @param intervalMs - Milliseconds between two calls.
 * @returns A function that stops the ticks.
 */
export function startTicking(tick: () => void, intervalMs: number): () => void {
	const timer = setInterval(tick, intervalMs);
	timer.unref();
	return () => {
		clearInterval(timer);
	};
}

/**
 * Joins the machine budget that every dev tool on this machine shares. Close
 * it once every Stryker run is done.
 *
 * @param workspaceRoot - The root of the repository; its git directory keys
 *   the learned costs.
 * @returns The budget, logging waits to stderr.
 */
export function openStrykerBudget(workspaceRoot: string): MachineBudget {
	return openMachineBudget({ log: console.error, workspaceRoot });
}

/**
 * Runs a package's Stryker CLI under Bun on workers leased from the machine
 * budget, growing the run while the budget allows.
 *
 * @param options - The run to make.
 * @param options.args - Arguments for the Stryker CLI.
 * @param options.budget - The budget from `openStrykerBudget`.
 * @param options.packageDirectory - Package with the Stryker install and
 *   config.
 * @param options.workspaceRoot - The repository root the cost is keyed under.
 * @returns The CLI's exit status, or undefined when it did not exit normally.
 */
export async function runStrykerInPackageAsync(options: {
	args: ReadonlyArray<string>;
	budget: MachineBudget;
	packageDirectory: string;
	workspaceRoot: string;
}): Promise<number | undefined> {
	const { args, packageDirectory } = options;
	return runAdaptiveStrykerAsync({
		budget: options.budget,
		log: console.error,
		parallelism: availableParallelism(),
		project: relative(options.workspaceRoot, packageDirectory).replaceAll("\\", "/"),
		schedule: (tick) => startTicking(tick, GROW_INTERVAL_MS),
		spawn: (environment) => {
			return spawnStryker({
				args,
				environment: { ...process.env, ...environment },
				packageDirectory,
			});
		},
		watchTree,
	});
}

function heldWorkers(leases: ReadonlyArray<Lease>): number {
	return leases.reduce((total, lease) => total + lease.workers, 0);
}

function ignoreClosedChannel(): void {
	// Stryker may exit between a tick and the send; the exit handler ends the
	// run.
}

/**
 * Leases more workers when the run cap allows and tells Stryker the new
 * capacity.
 *
 * @param run - The running Stryker and the leases it holds.
 */
function growOnce(run: RunningStryker): void {
	const { budget, log, project } = run.options;
	const count = workersToGrow({
		cap: budget.runCapWorkers(run.request),
		held: heldWorkers(run.leases),
		max: run.request.maxWorkers,
	});
	const lease =
		count === 0
			? undefined
			: budget.tryLease({ ...run.request, maxWorkers: count, minWorkers: 1 });
	if (lease === undefined) {
		return;
	}

	run.leases.push(lease);
	const capacity = heldWorkers(run.leases);
	run.child.send(setCapacityMessage(capacity), ignoreClosedChannel);
	log(`stryker: growing ${project} to ${String(capacity)} worker(s)`);
}

async function waitForExitAsync(child: StrykerChild): Promise<number | undefined> {
	return new Promise((resolve) => {
		child.on("error", () => {
			resolve(undefined);
		});
		child.on("exit", (code) => {
			resolve(code ?? undefined);
		});
	});
}

/**
 * Starts Stryker on the leases held and grows it until it exits.
 *
 * @param run - The run and the leases it holds; grown leases are added.
 * @returns The exit status and the tree peaks to report.
 */
async function superviseAsync({
	leases,
	options,
	request,
}: StrykerRun): Promise<{ report: LeaseReport | undefined; status: number | undefined }> {
	const { log, project } = options;
	const workers = heldWorkers(leases);
	const child = options.spawn({ [ADAPTIVE_CAPACITY_ENV]: String(workers) });
	const watch = child.pid === undefined ? undefined : options.watchTree(child.pid);
	log(`stryker: leased ${String(workers)} worker(s) for ${project}`);
	child.on("message", (message) => {
		const applied = parseCapacityApplied(message);
		if (applied !== undefined) {
			log(`stryker: ${project} runs ${String(applied)} worker(s)`);
		}
	});

	const cancel = options.schedule(() => {
		growOnce({ child, leases, options, request });
	});
	const status = await waitForExitAsync(child);
	cancel();
	const report = watch === undefined ? undefined : buildLeaseReport(watch.stop());
	if (report !== undefined) {
		log(`stryker: ${project} ${describePeaks(report)}`);
	}

	return { report, status };
}
