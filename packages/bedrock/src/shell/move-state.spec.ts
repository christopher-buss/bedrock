import { type } from "arktype";
import { assert, describe, expect, it } from "vitest";

import { fakeStateBackendPlugins, mergeStateBackendPlugins } from "#tests/helpers/plugins";
import { type FakeStateStore, fakeStateStore } from "#tests/helpers/state-store";
import type { PluginRegistry } from "../core/plugin-registry.ts";
import type { Config } from "../core/schema.ts";
import type { BedrockState, StateError } from "../core/state.ts";
import { moveStateAsync } from "./move-state.ts";

const PRODUCTION: BedrockState = { environment: "production", resources: [], version: 1 };

const STAGING: BedrockState = { environment: "staging", resources: [], version: 1 };

const REFUSAL: StateError = {
	file: "state.production.json",
	kind: "stateAccessDenied",
	reason: "the credential was refused",
};

const CONFIG: Config = {
	environments: { production: {}, staging: {} },
	state: { backend: "from" },
};

function noEnvironment(): undefined {}

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
});
