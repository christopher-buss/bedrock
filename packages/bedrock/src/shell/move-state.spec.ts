import { type } from "arktype";
import { assert, describe, expect, it } from "vitest";

import { fakeStateBackendPlugins, mergeStateBackendPlugins } from "#tests/helpers/plugins";
import { neverForceReleaseAsync, neverInspectAsync } from "#tests/helpers/state-lock";
import { type FakeStateStore, fakeStateStore } from "#tests/helpers/state-store";
import type { PluginRegistry } from "../core/plugin-registry.ts";
import type { Config } from "../core/schema.ts";
import type { BedrockState, StateError } from "../core/state.ts";
import type { StateLockError, StateLockHold, StateLockPort } from "../ports/state-lock-port.ts";
import { moveStateAsync } from "./move-state.ts";

const PRODUCTION: BedrockState = { environment: "production", resources: [], version: 1 };

const STAGING: BedrockState = { environment: "staging", resources: [], version: 1 };

const REFUSAL: StateError = {
	file: "state.production.json",
	kind: "stateAccessDenied",
	reason: "the credential was refused",
};

const LOCK_REFUSAL: StateLockError = { reason: "another run holds production" };

const CONFIG: Config = {
	environments: { production: {}, staging: {} },
	state: { backend: "from" },
};

interface FakeLockOptions {
	/** What each hold was asked for, appended in acquire order. */
	readonly operations?: Array<string | undefined>;
	/** Refusals to return from `acquire`, keyed by **Environment**. */
	readonly refuseAcquire?: Readonly<Record<string, StateLockError>>;
	/** Refusal every release returns, omitted when they all succeed. */
	readonly refuseRelease?: StateLockError;
	/** Log each call appends to. */
	readonly trace?: Array<string>;
}

interface LockingPlugins {
	readonly destination: FakeStateStore;
	readonly lock: StateLockPort;
	readonly source: FakeStateStore;
}

function noEnvironment(): undefined {}

function fakeLockPort(options: FakeLockOptions = {}): StateLockPort {
	function hold(environment: string): StateLockHold {
		return {
			release: async () => {
				options.trace?.push(`release:${environment}`);
				await Promise.resolve();
				return options.refuseRelease === undefined
					? { data: undefined, success: true }
					: { err: options.refuseRelease, success: false };
			},
		};
	}

	return {
		acquire: async (environment, acquireOptions) => {
			options.operations?.push(acquireOptions?.operation);
			options.trace?.push(`acquire:${environment}`);
			await Promise.resolve();
			const refusal = options.refuseAcquire?.[environment];
			return refusal === undefined
				? { data: hold(environment), success: true }
				: { err: refusal, success: false };
		},
		forceRelease: neverForceReleaseAsync,
		inspect: neverInspectAsync,
	};
}

function lockingPluginsFor({ destination, lock, source }: LockingPlugins): PluginRegistry {
	return mergeStateBackendPlugins(
		fakeStateBackendPlugins({
			name: "from",
			createLockPort: () => ({ data: lock, success: true }),
			createPort: () => ({ data: source.port, success: true }),
			schema: type({}),
			specifier: "@test/from",
		}),
		fakeStateBackendPlugins({
			name: "onto",
			createPort: () => ({ data: destination.port, success: true }),
			schema: type({}),
			specifier: "@test/onto",
		}),
	);
}

function pluginsFor(source: FakeStateStore, destination: FakeStateStore): PluginRegistry {
	return mergeStateBackendPlugins(
		fakeStateBackendPlugins({
			name: "from",
			createPort: () => ({ data: source.port, success: true }),
			schema: type({}),
			specifier: "@test/from",
		}),
		fakeStateBackendPlugins({
			name: "onto",
			createPort: () => ({ data: destination.port, success: true }),
			schema: type({}),
			specifier: "@test/onto",
		}),
	);
}

describe(moveStateAsync, () => {
	it("should write each environment's state onto the destination", async () => {
		expect.assertions(3);

		const source = fakeStateStore({ initial: { production: PRODUCTION, staging: STAGING } });
		const destination = fakeStateStore();

		const moved = await moveStateAsync(
			{ getEnv: noEnvironment, plugins: pluginsFor(source, destination) },
			{
				config: CONFIG,
				destination: { backend: "onto" },
				dryRun: false,
				environments: ["production", "staging"],
				force: false,
			},
		);

		assert(moved.success);

		expect(moved.data.moved).toStrictEqual(["production", "staging"]);
		expect(destination.states.get("production")).toBe(PRODUCTION);
		expect(destination.states.get("staging")).toBe(STAGING);
	});

	it("should fence each write on the record the destination reported", async () => {
		expect.assertions(1);

		const source = fakeStateStore({ initial: { production: PRODUCTION } });
		const destination = fakeStateStore();

		await moveStateAsync(
			{ getEnv: noEnvironment, plugins: pluginsFor(source, destination) },
			{
				config: CONFIG,
				destination: { backend: "onto" },
				dryRun: false,
				environments: ["production"],
				force: false,
			},
		);

		expect(destination.writes).toStrictEqual([
			{ environment: "production", expected: { kind: "absent" } },
		]);
	});

	it("should leave the source holding what it held", async () => {
		expect.assertions(2);

		const source = fakeStateStore({ initial: { production: PRODUCTION } });
		const destination = fakeStateStore();

		await moveStateAsync(
			{ getEnv: noEnvironment, plugins: pluginsFor(source, destination) },
			{
				config: CONFIG,
				destination: { backend: "onto" },
				dryRun: false,
				environments: ["production"],
				force: false,
			},
		);

		expect(source.writes).toBeEmpty();
		expect(source.states.get("production")).toBe(PRODUCTION);
	});

	it("should write nothing for an environment the source holds no state for", async () => {
		expect.assertions(2);

		const source = fakeStateStore({ initial: { production: PRODUCTION } });
		const destination = fakeStateStore();

		const moved = await moveStateAsync(
			{ getEnv: noEnvironment, plugins: pluginsFor(source, destination) },
			{
				config: CONFIG,
				destination: { backend: "onto" },
				dryRun: false,
				environments: ["production", "staging"],
				force: false,
			},
		);

		assert(moved.success);

		expect(moved.data.moved).toStrictEqual(["production"]);
		expect(destination.states.has("staging")).toBeFalse();
	});

	it("should write nothing at all when one environment is blocked", async () => {
		expect.assertions(3);

		const source = fakeStateStore({ initial: { production: PRODUCTION, staging: STAGING } });
		const destination = fakeStateStore({ initial: { staging: STAGING } });

		const moved = await moveStateAsync(
			{ getEnv: noEnvironment, plugins: pluginsFor(source, destination) },
			{
				config: CONFIG,
				destination: { backend: "onto" },
				dryRun: false,
				environments: ["production", "staging"],
				force: false,
			},
		);

		assert(!moved.success);
		assert(moved.err.kind === "moveBlocked");

		expect([...moved.err.blocked.keys()]).toStrictEqual(["staging"]);
		expect(destination.writes).toBeEmpty();
		expect(destination.states.has("production")).toBeFalse();
	});

	it("should overwrite an occupied destination when forced", async () => {
		expect.assertions(2);

		const source = fakeStateStore({ initial: { production: PRODUCTION } });
		const destination = fakeStateStore({ initial: { production: STAGING } });

		const moved = await moveStateAsync(
			{ getEnv: noEnvironment, plugins: pluginsFor(source, destination) },
			{
				config: CONFIG,
				destination: { backend: "onto" },
				dryRun: false,
				environments: ["production"],
				force: true,
			},
		);

		assert(moved.success);

		expect(destination.states.get("production")).toBe(PRODUCTION);
		expect(destination.writes).toStrictEqual([
			{ environment: "production", expected: undefined },
		]);
	});

	it("should report an environment whose config names no state block", async () => {
		expect.assertions(1);

		const source = fakeStateStore({ initial: { production: PRODUCTION } });
		const destination = fakeStateStore();

		const moved = await moveStateAsync(
			{ getEnv: noEnvironment, plugins: pluginsFor(source, destination) },
			{
				config: { environments: { production: {} } },
				destination: { backend: "onto" },
				dryRun: false,
				environments: ["production"],
				force: false,
			},
		);

		assert(!moved.success);

		expect(moved.err).toStrictEqual({
			cause: { environment: "production", kind: "stateNotConfigured" },
			environment: "production",
			kind: "sourceUnavailable",
		});
	});

	it("should report a source backend nothing claims", async () => {
		expect.assertions(1);

		const source = fakeStateStore();
		const destination = fakeStateStore();

		const moved = await moveStateAsync(
			{ getEnv: noEnvironment, plugins: pluginsFor(source, destination) },
			{
				config: { environments: { production: {} }, state: { backend: "nowhere" } },
				destination: { backend: "onto" },
				dryRun: false,
				environments: ["production"],
				force: false,
			},
		);

		assert(!moved.success);
		assert(moved.err.kind === "sourceUnavailable");

		expect(moved.err.cause).toContainEntry(["kind", "unsupportedBackend"]);
	});

	it("should report a destination backend nothing claims", async () => {
		expect.assertions(1);

		const source = fakeStateStore({ initial: { production: PRODUCTION } });
		const destination = fakeStateStore();

		const moved = await moveStateAsync(
			{ getEnv: noEnvironment, plugins: pluginsFor(source, destination) },
			{
				config: CONFIG,
				destination: { backend: "nowhere" },
				dryRun: false,
				environments: ["production"],
				force: false,
			},
		);

		assert(!moved.success);
		assert(moved.err.kind === "destinationUnavailable");

		expect(moved.err.cause).toContainEntry(["kind", "unsupportedBackend"]);
	});

	it("should report a write that failed and what had already moved", async () => {
		expect.assertions(1);

		const source = fakeStateStore({ initial: { production: PRODUCTION, staging: STAGING } });
		const destination = fakeStateStore({ refuseWrite: { staging: REFUSAL } });

		const moved = await moveStateAsync(
			{ getEnv: noEnvironment, plugins: pluginsFor(source, destination) },
			{
				config: CONFIG,
				destination: { backend: "onto" },
				dryRun: false,
				environments: ["production", "staging"],
				force: false,
			},
		);

		assert(!moved.success);

		expect(moved.err).toStrictEqual({
			cause: REFUSAL,
			environment: "staging",
			kind: "writeFailed",
			moved: ["production"],
		});
	});

	it("should block an environment whose source cannot be read", async () => {
		expect.assertions(1);

		const source = fakeStateStore({ refuseRead: { production: REFUSAL } });
		const destination = fakeStateStore();

		const moved = await moveStateAsync(
			{ getEnv: noEnvironment, plugins: pluginsFor(source, destination) },
			{
				config: CONFIG,
				destination: { backend: "onto" },
				dryRun: false,
				environments: ["production"],
				force: false,
			},
		);

		assert(!moved.success);
		assert(moved.err.kind === "moveBlocked");

		expect(moved.err.blocked.get("production")).toStrictEqual({
			err: REFUSAL,
			kind: "sourceUnreadable",
		});
	});

	it("should hold the source environment from before its read until after its write", async () => {
		expect.assertions(1);

		const trace: Array<string> = [];
		const source = fakeStateStore({ initial: { production: PRODUCTION } });
		const destination = fakeStateStore({ trace });

		const moved = await moveStateAsync(
			{
				getEnv: noEnvironment,
				plugins: lockingPluginsFor({ destination, lock: fakeLockPort({ trace }), source }),
			},
			{
				config: CONFIG,
				destination: { backend: "onto" },
				dryRun: false,
				environments: ["production"],
				force: false,
			},
		);

		assert(moved.success);

		expect(trace).toStrictEqual([
			"acquire:production",
			"read:production",
			"write:production",
			"release:production",
		]);
	});

	it("should report the exclusion each environment moved under", async () => {
		expect.assertions(1);

		const source = fakeStateStore({ initial: { production: PRODUCTION } });
		const destination = fakeStateStore();

		const moved = await moveStateAsync(
			{
				getEnv: noEnvironment,
				plugins: lockingPluginsFor({ destination, lock: fakeLockPort(), source }),
			},
			{
				config: CONFIG,
				destination: { backend: "onto" },
				dryRun: false,
				environments: ["production"],
				force: false,
			},
		);

		assert(moved.success);

		expect(moved.data.locking.get("production")).toBe("exclusive");
	});

	it("should move without a hold when the source backend offers none", async () => {
		expect.assertions(2);

		const source = fakeStateStore({ initial: { production: PRODUCTION } });
		const destination = fakeStateStore();

		const moved = await moveStateAsync(
			{ getEnv: noEnvironment, plugins: pluginsFor(source, destination) },
			{
				config: CONFIG,
				destination: { backend: "onto" },
				dryRun: false,
				environments: ["production"],
				force: false,
			},
		);

		assert(moved.success);

		expect(moved.data.moved).toStrictEqual(["production"]);
		expect(moved.data.locking.get("production")).toBe("none");
	});

	it("should give back the holds it already took when a later one is refused", async () => {
		expect.assertions(2);

		const trace: Array<string> = [];
		const source = fakeStateStore({ initial: { production: PRODUCTION, staging: STAGING } });
		const destination = fakeStateStore({ trace });
		const lock = fakeLockPort({ refuseAcquire: { staging: LOCK_REFUSAL }, trace });

		const moved = await moveStateAsync(
			{ getEnv: noEnvironment, plugins: lockingPluginsFor({ destination, lock, source }) },
			{
				config: CONFIG,
				destination: { backend: "onto" },
				dryRun: false,
				environments: ["production", "staging"],
				force: false,
			},
		);

		assert(!moved.success);

		expect(moved.err).toStrictEqual({
			cause: LOCK_REFUSAL,
			environment: "staging",
			kind: "lockAcquireFailed",
		});
		expect(trace).toStrictEqual([
			"acquire:production",
			"acquire:staging",
			"release:production",
		]);
	});

	it("should stand by a move whose hold could not be given up", async () => {
		expect.assertions(1);

		const source = fakeStateStore({ initial: { production: PRODUCTION } });
		const destination = fakeStateStore();
		const lock = fakeLockPort({ refuseRelease: LOCK_REFUSAL });

		const moved = await moveStateAsync(
			{ getEnv: noEnvironment, plugins: lockingPluginsFor({ destination, lock, source }) },
			{
				config: CONFIG,
				destination: { backend: "onto" },
				dryRun: false,
				environments: ["production"],
				force: false,
			},
		);

		assert(moved.success);

		expect(moved.data.moved).toStrictEqual(["production"]);
	});

	it("should record what each hold was taken for", async () => {
		expect.assertions(1);

		const operations: Array<string | undefined> = [];
		const source = fakeStateStore({ initial: { production: PRODUCTION } });
		const destination = fakeStateStore();

		await moveStateAsync(
			{
				getEnv: noEnvironment,
				plugins: lockingPluginsFor({
					destination,
					lock: fakeLockPort({ operations }),
					source,
				}),
			},
			{
				config: CONFIG,
				destination: { backend: "onto" },
				dryRun: false,
				environments: ["production"],
				force: false,
			},
		);

		expect(operations).toStrictEqual(["state move"]);
	});

	it("should write nothing when the move is a dry run", async () => {
		expect.assertions(3);

		const source = fakeStateStore({ initial: { production: PRODUCTION } });
		const destination = fakeStateStore();

		const moved = await moveStateAsync(
			{ getEnv: noEnvironment, plugins: pluginsFor(source, destination) },
			{
				config: CONFIG,
				destination: { backend: "onto" },
				dryRun: true,
				environments: ["production"],
				force: false,
			},
		);

		assert(moved.success);

		expect(destination.writes).toBeEmpty();
		expect(moved.data.moved).toBeEmpty();
		expect(moved.data.decisions.get("production")!.kind).toBe("move");
	});

	it("should take no hold for a dry run", async () => {
		expect.assertions(1);

		const trace: Array<string> = [];
		const source = fakeStateStore({ initial: { production: PRODUCTION } });
		const destination = fakeStateStore();

		await moveStateAsync(
			{
				getEnv: noEnvironment,
				plugins: lockingPluginsFor({
					destination,
					lock: fakeLockPort({ trace }),
					source,
				}),
			},
			{
				config: CONFIG,
				destination: { backend: "onto" },
				dryRun: true,
				environments: ["production"],
				force: false,
			},
		);

		expect(trace).toBeEmpty();
	});

	it("should still report what stands in the way of a dry run", async () => {
		expect.assertions(1);

		const source = fakeStateStore({ initial: { production: PRODUCTION } });
		const destination = fakeStateStore({ initial: { production: STAGING } });

		const moved = await moveStateAsync(
			{ getEnv: noEnvironment, plugins: pluginsFor(source, destination) },
			{
				config: CONFIG,
				destination: { backend: "onto" },
				dryRun: true,
				environments: ["production"],
				force: false,
			},
		);

		assert(!moved.success);

		expect(moved.err.kind).toBe("moveBlocked");
	});
});
