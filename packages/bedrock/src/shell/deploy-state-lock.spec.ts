import { type } from "arktype";
import { assert, describe, expect, it } from "vitest";

import { environmentFrom } from "#tests/helpers/environment";
import { fakeStateBackendPlugins } from "#tests/helpers/plugins";
import { fakeStateLock } from "#tests/helpers/state-lock";
import type { ResourceKind } from "../core/resources.ts";
import type { Config } from "../core/schema.ts";
import type { ProgressEvent, ProgressPort } from "../ports/progress-port.ts";
import type { DriverRegistry, ResourceDriver } from "../ports/resource-driver.ts";
import type { StateLockPort, StateLockWaiting } from "../ports/state-lock-port.ts";
import type { StatePort } from "../ports/state-port.ts";
import { asResourceKey, asRobloxAssetId, asSha256Hex } from "../types/ids.ts";
import { deploy, provision } from "./deploy.ts";

const ICON_HASH = asSha256Hex("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

const SILENT_PROGRESS: ProgressPort = { emit: () => {} };

const CONTENDED_WAIT: StateLockWaiting = {
	elapsedMs: 1000,
	holder: "ci-run-7",
	remainingMs: 299_000,
};

const WAIT_EVENT_TAIL = { environment: "production", kind: "stateLockWaiting" } as const;

async function readIconAsync(): Promise<Uint8Array> {
	return new Uint8Array();
}

function vipPassConfig(): Config {
	return {
		environments: { production: {} },
		passes: {
			"vip-pass": {
				name: "VIP Pass",
				description: "Grants VIP perks.",
				icon: { "en-us": "assets/vip-icon.png" },
				price: 500,
			},
		},
	};
}

function vipPassCurrent() {
	return {
		key: asResourceKey("vip-pass"),
		name: "VIP Pass",
		description: "Grants VIP perks.",
		icon: { "en-us": "assets/vip-icon.png" },
		iconFileHashes: { "en-us": ICON_HASH },
		kind: "gamePass" as const,
		outputs: {
			assetId: asRobloxAssetId("9876543210"),
			iconAssetIds: { "en-us": asRobloxAssetId("1122334455") },
		},
		price: 500,
	};
}

function neverDriver<K extends ResourceKind>(): ResourceDriver<K> {
	return {
		async create() {
			throw new Error("driver must not run for this fixture");
		},
	};
}

/**
 * Build a registry whose game-pass create records that it ran.
 *
 * @param trace - Log the create appends to when it is dispatched.
 * @returns A driver table whose game-pass create succeeds.
 */
function tracingRegistry(trace: Array<string>): DriverRegistry {
	return {
		developerProduct: neverDriver(),
		gamePass: {
			async create() {
				trace.push("create");
				return { data: vipPassCurrent(), success: true };
			},
		},
		place: neverDriver(),
		universe: neverDriver(),
	};
}

/**
 * Build a state port whose write records that it ran.
 *
 * @param trace - Log the write appends to when the snapshot is persisted.
 * @returns A state port that reads empty and accepts every write.
 */
function tracingStatePort(trace: Array<string>): StatePort {
	return {
		async read() {
			return { data: undefined, success: true };
		},
		async write() {
			trace.push("write");
			return { data: undefined, success: true };
		},
	};
}

function refusingWriteStatePort(): StatePort {
	return {
		async read() {
			return { data: undefined, success: true };
		},
		async write() {
			return {
				err: {
					file: "state/production.json",
					kind: "stateAccessDenied",
					reason: "the credential was refused",
				},
				success: false,
			};
		},
	};
}

/**
 * Collect every progress event the deploy emits, in order.
 *
 * @param events - Log each event is appended to.
 * @returns A progress port that records rather than renders.
 */
function recordingProgress(events: Array<ProgressEvent>): ProgressPort {
	return {
		emit(event) {
			events.push(event);
		},
	};
}

/**
 * Wrap a lock port so it reports one wait before granting the hold, which
 * is what a **Backend** does while another run holds the environment.
 *
 * @param port - The port that grants the hold once the wait is reported.
 * @param waiting - The wait to report.
 * @returns A port that reports the wait, then delegates.
 */
function waitingLockPort(port: StateLockPort, waiting: StateLockWaiting): StateLockPort {
	return {
		async acquire(environment, options) {
			options?.onWaiting?.(waiting);
			return port.acquire(environment);
		},
	};
}

/**
 * Wrap a lock port so it records what the caller said the hold is for.
 *
 * @param port - The port that grants the hold.
 * @param asked - Log each acquisition's operation is appended to.
 * @returns A port that records the operation, then delegates.
 */
function operationRecordingLockPort(
	port: StateLockPort,
	asked: Array<string | undefined>,
): StateLockPort {
	return {
		async acquire(environment, options) {
			asked.push(options?.operation);
			return port.acquire(environment);
		},
	};
}

describe("deploy under a locking backend", () => {
	it("should take the hold before dispatching any driver", async () => {
		expect.assertions(2);

		const trace: Array<string> = [];
		const lock = fakeStateLock();

		const result = await deploy({
			config: vipPassConfig(),
			environment: "production",
			getEnv: environmentFrom({}),
			progress: SILENT_PROGRESS,
			readFile: readIconAsync,
			registry: tracingRegistry(trace),
			stateLockPort: {
				acquire: async (environment) => {
					trace.push("acquire");
					return lock.port.acquire(environment);
				},
			},
			statePort: tracingStatePort(trace),
		});

		assert(result.success);

		expect(trace).toStrictEqual(["acquire", "create", "write"]);
		expect(lock.acquired).toStrictEqual(["production"]);
	});

	it("should report a contended wait through the progress port before applying anything", async () => {
		expect.assertions(1);

		const events: Array<ProgressEvent> = [];

		const result = await deploy({
			config: vipPassConfig(),
			environment: "production",
			getEnv: environmentFrom({}),
			progress: recordingProgress(events),
			readFile: readIconAsync,
			registry: tracingRegistry([]),
			stateLockPort: waitingLockPort(fakeStateLock().port, CONTENDED_WAIT),
			statePort: tracingStatePort([]),
		});

		assert(result.success);

		expect(events[0]).toStrictEqual({ ...CONTENDED_WAIT, ...WAIT_EVENT_TAIL });
	});

	it("should tell the backend which operation the hold is for", async () => {
		expect.assertions(1);

		const asked: Array<string | undefined> = [];

		const result = await deploy({
			config: vipPassConfig(),
			environment: "production",
			getEnv: environmentFrom({}),
			progress: SILENT_PROGRESS,
			readFile: readIconAsync,
			registry: tracingRegistry([]),
			stateLockPort: operationRecordingLockPort(fakeStateLock().port, asked),
			statePort: tracingStatePort([]),
		});

		assert(result.success);

		expect(asked).toStrictEqual(["deploy"]);
	});

	it("should give the hold up once the state write has been attempted", async () => {
		expect.assertions(2);

		const trace: Array<string> = [];
		const lock = fakeStateLock();

		const result = await deploy({
			config: vipPassConfig(),
			environment: "production",
			getEnv: environmentFrom({}),
			progress: SILENT_PROGRESS,
			readFile: readIconAsync,
			registry: tracingRegistry(trace),
			stateLockPort: lock.port,
			statePort: tracingStatePort(trace),
		});

		assert(result.success);

		expect(trace).toStrictEqual(["create", "write"]);
		expect(lock.released).toStrictEqual(["production"]);
	});

	it("should give the hold up when the state write fails", async () => {
		expect.assertions(2);

		const lock = fakeStateLock();

		const result = await deploy({
			config: vipPassConfig(),
			environment: "production",
			getEnv: environmentFrom({}),
			progress: SILENT_PROGRESS,
			readFile: readIconAsync,
			registry: tracingRegistry([]),
			stateLockPort: lock.port,
			statePort: refusingWriteStatePort(),
		});

		assert(!result.success);

		expect(result.err.kind).toBe("stateWriteFailed");
		expect(lock.released).toStrictEqual(["production"]);
	});

	it("should give the hold up when the deploy throws", async () => {
		expect.assertions(2);

		const lock = fakeStateLock();

		const thrown = deploy({
			config: vipPassConfig(),
			environment: "production",
			getEnv: environmentFrom({}),
			progress: SILENT_PROGRESS,
			readFile: readIconAsync,
			registry: tracingRegistry([]),
			stateLockPort: lock.port,
			statePort: {
				read: async () => {
					throw new Error("state store unreachable");
				},
				write: async () => ({ data: undefined, success: true }),
			},
		});

		await expect(thrown).rejects.toThrow("state store unreachable");

		expect(lock.released).toStrictEqual(["production"]);
	});

	it("should abort with lockAcquireFailed before dispatching any driver when the hold is refused", async () => {
		expect.assertions(3);

		const trace: Array<string> = [];
		const lock = fakeStateLock({
			refuseAcquire: {
				detail: { holder: "ci-run-42" },
				reason: "production is already held",
			},
		});

		const result = await deploy({
			config: vipPassConfig(),
			environment: "production",
			getEnv: environmentFrom({}),
			progress: SILENT_PROGRESS,
			readFile: readIconAsync,
			registry: tracingRegistry(trace),
			stateLockPort: lock.port,
			statePort: tracingStatePort(trace),
		});

		assert(!result.success);
		assert(result.err.kind === "lockAcquireFailed");

		expect(result.err.cause.reason).toBe("production is already held");
		expect(result.err.cause.detail).toStrictEqual({ holder: "ci-run-42" });
		expect(trace).toBeEmpty();
	});

	it("should keep the deploy result when the hold cannot be given up", async () => {
		expect.assertions(2);

		const lock = fakeStateLock({ refuseRelease: { reason: "lock record already gone" } });

		const result = await deploy({
			config: vipPassConfig(),
			environment: "production",
			getEnv: environmentFrom({}),
			progress: SILENT_PROGRESS,
			readFile: readIconAsync,
			registry: tracingRegistry([]),
			stateLockPort: lock.port,
			statePort: tracingStatePort([]),
		});

		assert(result.success);

		expect(result.data.resources).toHaveLength(1);
		expect(lock.released).toStrictEqual(["production"]);
	});

	it("should keep the deploy result when giving the hold up throws", async () => {
		expect.assertions(2);

		const released: Array<string> = [];

		const result = await deploy({
			config: vipPassConfig(),
			environment: "production",
			getEnv: environmentFrom({}),
			progress: SILENT_PROGRESS,
			readFile: readIconAsync,
			registry: tracingRegistry([]),
			stateLockPort: {
				acquire: async (environment) => {
					return {
						data: {
							release: async () => {
								released.push(environment);
								throw new Error("lock store unreachable");
							},
						},
						success: true,
					};
				},
			},
			statePort: refusingWriteStatePort(),
		});

		assert(!result.success);

		expect(result.err.kind).toBe("stateWriteFailed");
		expect(released).toStrictEqual(["production"]);
	});

	it("should take the hold the configured backend supplies", async () => {
		expect.assertions(2);

		const trace: Array<string> = [];
		const lock = fakeStateLock();
		const statePort = tracingStatePort(trace);

		const result = await deploy({
			config: { ...vipPassConfig(), state: { backend: "s3", bucket: "my-bucket" } },
			environment: "production",
			getEnv: environmentFrom({}),
			plugins: fakeStateBackendPlugins({
				name: "s3",
				createLockPort: () => ({ data: lock.port, success: true }),
				createPort: () => ({ data: statePort, success: true }),
				schema: type({ bucket: "string > 0" }),
				specifier: "@example/state-s3",
			}),
			progress: SILENT_PROGRESS,
			readFile: readIconAsync,
			registry: tracingRegistry(trace),
		});

		assert(result.success);

		expect(lock.acquired).toStrictEqual(["production"]);
		expect(lock.released).toStrictEqual(["production"]);
	});

	it("should take the hold for a provision, which shares the deploy's lifetime", async () => {
		expect.assertions(2);

		const trace: Array<string> = [];
		const lock = fakeStateLock();

		const result = await provision({
			config: vipPassConfig(),
			environment: "production",
			getEnv: environmentFrom({}),
			progress: SILENT_PROGRESS,
			readFile: readIconAsync,
			registry: tracingRegistry(trace),
			stateLockPort: lock.port,
			statePort: tracingStatePort(trace),
		});

		assert(result.success);

		expect(lock.acquired).toStrictEqual(["production"]);
		expect(lock.released).toStrictEqual(["production"]);
	});

	it("should deploy without taking a hold when the backend declares no locking", async () => {
		expect.assertions(2);

		const trace: Array<string> = [];

		const result = await deploy({
			config: vipPassConfig(),
			environment: "production",
			getEnv: environmentFrom({}),
			progress: SILENT_PROGRESS,
			readFile: readIconAsync,
			registry: tracingRegistry(trace),
			statePort: tracingStatePort(trace),
		});

		assert(result.success);

		expect(trace).toStrictEqual(["create", "write"]);
		expect(result.data.resources).toHaveLength(1);
	});
});
