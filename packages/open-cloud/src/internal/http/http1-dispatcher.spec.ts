import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";

import { createHttp1Dispatcher } from "./http1-dispatcher.ts";

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

	it("should fall back to undici's pre-8 symbol", () => {
		expect.assertions(1);

		const { scope } = scopeWithAgent("undici.globalDispatcher.1");

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

	// Every malformed shape reaches the same `catch`; the table records which
	// shapes were considered, not distinct outcomes.
	it.for<[label: string, published: unknown]>([
		["a primitive", "not-an-agent"],
		// eslint-disable-next-line unicorn/no-null -- typeof null is "object"
		["null", null],
		["an object with no constructor", Object.create(null)],
		[
			"a constructor that throws",
			{
				constructor: () => {
					throw new Error("contract moved");
				},
			},
		],
	])("should return undefined when the runtime publishes %s", ([, published]) => {
		expect.assertions(1);

		const scope = { [Symbol.for("undici.globalDispatcher.2")]: published };

		expect(createHttp1Dispatcher(scope)).toBeUndefined();
	});

	// A tripwire, not a unit test: the symbol is undici's internal contract and
	// already moved once. Every other test here injects a fake scope, so only
	// this one notices the day the real global stops being reachable — which is
	// the day the h2 outage comes back, silently. Bun publishes no such global
	// and does not negotiate h2 from `fetch`, so it is exempt.
	it.skipIf("Bun" in globalThis)(
		"should reach the dispatcher this runtime actually publishes",
		async () => {
			expect.assertions(1);

			// undici publishes the global lazily, on first use.
			await fetch("http://127.0.0.1:1/").catch(() => {});

			expect(createHttp1Dispatcher()).toBeDefined();
		},
	);
});
