import type {
	Lease,
	LeaseReport,
	LeaseRequest,
	MachineBudget,
	TreePeaks,
} from "@isentinel/machine-budget";

import { EventEmitter } from "node:events";
import { describe, it, vi } from "vitest";

import { runAdaptiveStrykerAsync, startTicking } from "./stryker-adaptive.ts";
import type { StrykerChild } from "./stryker-adaptive.ts";

interface FakeLease {
	readonly lease: Lease;
	readonly reports: Array<LeaseReport | undefined>;
}

interface FakeBudget {
	readonly budget: MachineBudget;
	readonly requests: Array<{ kind: string; request: LeaseRequest }>;
}

interface Harness {
	cancelled: boolean;
	readonly child: FakeChild;
	readonly env: Array<Record<string, string>>;
	readonly lines: Array<string>;
	run: Promise<number | undefined>;
	readonly tick: () => void;
	readonly watched: Array<number>;
}

class FakeChild extends EventEmitter implements StrykerChild {
	public readonly pid: number | undefined;
	public readonly sent: Array<unknown> = [];

	constructor(pid: number | undefined) {
		super();
		this.pid = pid;
	}

	public send(message: unknown, callback: (error: Error | null) => void): boolean {
		this.sent.push(message);
		callback(new Error("channel closed"));
		return true;
	}
}

function fakeLease(workers: number): FakeLease {
	const reports: Array<LeaseReport | undefined> = [];
	return {
		lease: {
			memoryPerWorker: 1,
			release: (report) => {
				reports.push(report);
			},
			workers,
		},
		reports,
	};
}

function fakeBudget(options: {
	cap: number;
	first: FakeLease;
	grown: Array<FakeLease | undefined>;
}): FakeBudget {
	const requests: Array<{ kind: string; request: LeaseRequest }> = [];
	const grown = [...options.grown];
	return {
		budget: {
			close: () => {},
			isShared: true,
			leaseAsync: async (request) => {
				requests.push({ kind: "leaseAsync", request });
				return options.first.lease;
			},
			runCapWorkers: () => options.cap,
			tryLease: (request) => {
				requests.push({ kind: "tryLease", request });
				return grown.shift()?.lease;
			},
		},
		requests,
	};
}

function startHarness(options: {
	budget: MachineBudget;
	peaks?: TreePeaks;
	pid?: number | undefined;
}): Harness {
	const child = new FakeChild("pid" in options ? options.pid : 4242);
	let tick: (() => void) | undefined;
	const harness: Harness = {
		cancelled: false,
		child,
		env: [],
		lines: [],
		run: Promise.resolve(undefined),
		tick: () => tick?.(),
		watched: [],
	};
	harness.run = runAdaptiveStrykerAsync({
		budget: options.budget,
		log: (line) => {
			harness.lines.push(line);
		},
		parallelism: 8,
		project: "packages/actions",
		schedule: (next) => {
			tick = next;
			return () => {
				harness.cancelled = true;
			};
		},
		spawn: (environment) => {
			harness.env.push(environment);
			return child;
		},
		watchTree: (pid) => {
			harness.watched.push(pid);
			return {
				stop: () => options.peaks ?? { peakMemory: undefined, peakPerWorker: undefined },
			};
		},
	});
	return harness;
}

function isTimer(value: unknown): value is NodeJS.Timeout {
	return typeof value === "object" && value !== null && "hasRef" in value;
}

function timerHasRef(value: unknown): boolean | undefined {
	return isTimer(value) ? value.hasRef() : undefined;
}

async function settleAsync(): Promise<void> {
	await new Promise((resolve) => {
		setImmediate(resolve);
	});
}

const REQUEST: LeaseRequest = {
	cost: { pass: "stryker", project: "packages/actions" },
	isMainLaneOnly: true,
	maxWorkers: 7,
	memoryPerWorker: 1024 * 1024 * 1024,
	minWorkers: 2,
};

describe(runAdaptiveStrykerAsync, () => {
	it("should spawn Stryker with the leased workers and watch its tree", async ({ expect }) => {
		expect.assertions(3);

		const { budget, requests } = fakeBudget({ cap: 3, first: fakeLease(3), grown: [] });
		const harness = startHarness({ budget });
		await settleAsync();
		harness.child.emit("exit", 0);
		await harness.run;

		expect(requests).toStrictEqual([{ kind: "leaseAsync", request: REQUEST }]);
		expect(harness.env).toStrictEqual([{ STRYKER_ADAPTIVE_INITIAL_CAPACITY: "3" }]);
		expect(harness.watched).toStrictEqual([4242]);
	});

	it("should grow the run and send each new capacity while the run cap allows", async ({
		expect,
	}) => {
		expect.assertions(3);

		const second = fakeLease(2);
		const { budget, requests } = fakeBudget({
			cap: 6,
			first: fakeLease(2),
			grown: [second, undefined],
		});
		const harness = startHarness({ budget });
		await settleAsync();
		harness.tick();
		harness.tick();
		harness.tick();
		harness.child.emit("exit", 0);
		await harness.run;

		expect(requests.slice(1)).toStrictEqual([
			{ kind: "tryLease", request: { ...REQUEST, maxWorkers: 4, minWorkers: 1 } },
			{ kind: "tryLease", request: { ...REQUEST, maxWorkers: 2, minWorkers: 1 } },
			{ kind: "tryLease", request: { ...REQUEST, maxWorkers: 2, minWorkers: 1 } },
		]);
		expect(harness.child.sent).toStrictEqual([{ capacity: 4, type: "stryker:set-capacity" }]);
		expect(harness.lines).toContain("stryker: growing packages/actions to 4 worker(s)");
	});

	it("should not ask for more workers once the run reaches its cap", async ({ expect }) => {
		expect.assertions(1);

		const { budget, requests } = fakeBudget({ cap: 9, first: fakeLease(7), grown: [] });
		const harness = startHarness({ budget });
		await settleAsync();
		harness.tick();
		harness.child.emit("exit", 0);
		await harness.run;

		expect(requests.map(({ kind }) => kind)).toStrictEqual(["leaseAsync"]);
	});

	it("should log the capacity Stryker reports it applied", async ({ expect }) => {
		expect.assertions(1);

		const { budget } = fakeBudget({ cap: 2, first: fakeLease(2), grown: [] });
		const harness = startHarness({ budget });
		await settleAsync();
		harness.child.emit("message", { capacity: 2, type: "stryker:capacity-applied" });
		harness.child.emit("message", { type: "other" });
		harness.child.emit("exit", 0);
		await harness.run;

		expect(harness.lines).toStrictEqual([
			"stryker: leased 2 worker(s) for packages/actions",
			"stryker: packages/actions runs 2 worker(s)",
		]);
	});

	it("should report the tree peaks once and release every lease on exit", async ({ expect }) => {
		expect.assertions(5);

		const first = fakeLease(2);
		const second = fakeLease(1);
		const { budget } = fakeBudget({ cap: 3, first, grown: [second] });
		const harness = startHarness({
			budget,
			peaks: { peakMemory: 3000 * 1024 * 1024, peakPerWorker: 900 * 1024 * 1024 },
		});
		await settleAsync();
		harness.tick();
		harness.child.emit("exit", 7);

		await expect(harness.run).resolves.toBe(7);
		expect(first.reports).toStrictEqual([
			{ peakMemory: 3000 * 1024 * 1024, peakPerWorker: 900 * 1024 * 1024 },
		]);
		expect(harness.lines).toContain(
			"stryker: packages/actions peak 3000 MiB, 900 MiB per worker",
		);
		expect(second.reports).toStrictEqual([undefined]);
		expect(harness.cancelled).toBe(true);
	});

	it("should release without a report when the platform reads no peaks", async ({ expect }) => {
		expect.assertions(2);

		const first = fakeLease(2);
		const { budget } = fakeBudget({ cap: 2, first, grown: [] });
		const harness = startHarness({ budget });
		await settleAsync();
		harness.child.emit("exit", 0);
		await harness.run;

		expect(first.reports).toStrictEqual([undefined]);
		expect(harness.lines).toStrictEqual(["stryker: leased 2 worker(s) for packages/actions"]);
	});

	it("should report no status when Stryker ends on a signal", async ({ expect }) => {
		expect.assertions(1);

		const { budget } = fakeBudget({ cap: 2, first: fakeLease(2), grown: [] });
		const harness = startHarness({ budget });
		await settleAsync();
		harness.child.emit("exit", undefined, "SIGTERM");

		await expect(harness.run).resolves.toBeUndefined();
	});

	it("should release the lease and report no status when Stryker fails to start", async ({
		expect,
	}) => {
		expect.assertions(3);

		const first = fakeLease(2);
		const { budget } = fakeBudget({ cap: 2, first, grown: [] });
		const harness = startHarness({ budget, pid: undefined });
		await settleAsync();
		harness.child.emit("error", new Error("spawn failed"));

		await expect(harness.run).resolves.toBeUndefined();
		expect(harness.watched).toStrictEqual([]);
		expect(first.reports).toStrictEqual([undefined]);
	});
});

describe(startTicking, () => {
	it("should not keep the process alive", ({ expect }) => {
		expect.assertions(1);

		const created = vi.spyOn(globalThis, "setInterval");
		const cancel = startTicking(() => {}, 60_000);
		const hasRef = timerHasRef(created.mock.results[0]!.value);
		cancel();
		created.mockRestore();

		expect(hasRef).toBe(false);
	});

	it("should call the tick on each interval until cancelled", ({ expect }) => {
		expect.assertions(2);

		vi.useFakeTimers();
		const tick = vi.fn<() => void>();
		const cancel = startTicking(tick, 500);
		vi.advanceTimersByTime(1000);
		const ticksBeforeCancel = tick.mock.calls.length;
		cancel();
		vi.advanceTimersByTime(1000);
		vi.useRealTimers();

		expect(ticksBeforeCancel).toBe(2);
		expect(tick).toHaveBeenCalledTimes(2);
	});
});
