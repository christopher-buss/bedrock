import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";

import { createHttp1Dispatcher, GLOBAL_DISPATCHER_KEYS } from "./http1-dispatcher.ts";

interface AgentOptions {
	allowH2: boolean;
}

/**
 * Builds a scope mimicking the runtime global that carries undici's global
 * dispatcher: an agent instance whose `constructor` accepts an options bag.
 * Modelled as a plain object rather than a class so the spy sees the
 * construction the SDK performs, and only that one.
 *
 * @param key - The well-known symbol key to publish the agent under.
 * @returns The scope plus the constructor spy, so tests can assert the options.
 */
function scopeWithAgent(key: string): {
	construct: Mock<(options: AgentOptions) => void>;
	scope: object;
} {
	const construct = vi.fn<(options: AgentOptions) => void>();
	return { construct, scope: { [Symbol.for(key)]: { constructor: construct } } };
}

describe(createHttp1Dispatcher, () => {
	it("should build a dispatcher that refuses http/2", () => {
		expect.assertions(2);

		const { construct, scope } = scopeWithAgent("undici.globalDispatcher.2");

		expect(createHttp1Dispatcher(scope)).toBeDefined();
		expect(construct.mock.calls).toStrictEqual([[{ allowH2: false }]]);
	});

	it.for(GLOBAL_DISPATCHER_KEYS)("should find the global dispatcher at %s", (key) => {
		expect.assertions(1);

		const { scope } = scopeWithAgent(key);

		expect(createHttp1Dispatcher(scope)).toBeDefined();
	});

	it("should prefer the newest key when the runtime publishes several", () => {
		expect.assertions(2);

		const newest = scopeWithAgent("undici.globalDispatcher.2");
		const legacy = scopeWithAgent("undici.globalDispatcher.1");

		createHttp1Dispatcher({ ...newest.scope, ...legacy.scope });

		expect(newest.construct.mock.calls).toStrictEqual([[{ allowH2: false }]]);
		expect(legacy.construct).not.toHaveBeenCalled();
	});

	it("should return undefined when the runtime publishes no dispatcher", () => {
		expect.assertions(1);

		expect(createHttp1Dispatcher({})).toBeUndefined();
	});

	it("should return undefined when the published dispatcher is not an object", () => {
		expect.assertions(1);

		const scope = { [Symbol.for("undici.globalDispatcher.2")]: "not-an-agent" };

		expect(createHttp1Dispatcher(scope)).toBeUndefined();
	});

	it("should return undefined when the published dispatcher is null", () => {
		expect.assertions(1);

		// eslint-disable-next-line unicorn/no-null -- typeof null is "object"
		const scope = { [Symbol.for("undici.globalDispatcher.2")]: null };

		expect(createHttp1Dispatcher(scope)).toBeUndefined();
	});

	it("should return undefined when the published dispatcher has no constructor", () => {
		expect.assertions(1);

		const scope = { [Symbol.for("undici.globalDispatcher.2")]: Object.create(null) };

		expect(createHttp1Dispatcher(scope)).toBeUndefined();
	});

	it("should return undefined when constructing the dispatcher throws", () => {
		expect.assertions(1);

		const scope = {
			[Symbol.for("undici.globalDispatcher.2")]: {
				constructor: () => {
					throw new Error("contract moved");
				},
			},
		};

		expect(createHttp1Dispatcher(scope)).toBeUndefined();
	});
});
