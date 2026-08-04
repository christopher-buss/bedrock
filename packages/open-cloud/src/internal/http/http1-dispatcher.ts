/** The shape the global dispatcher's class is assumed to have. */
type AgentConstructor = new (options: { allowH2: boolean }) => object;

/**
 * Well-known globals under which undici publishes its global dispatcher,
 * newest first. The suffix is undici's own contract version: it moved from
 * `.1` to `.2` in undici 8, so a future major may move it again. Both are
 * probed, and {@link createHttp1Dispatcher} degrades to `undefined` when
 * neither is present — which is also the Bun path, since Bun's `fetch` is not
 * undici-backed and never publishes these.
 */
const GLOBAL_DISPATCHER_KEYS: ReadonlyArray<string> = Object.freeze([
	"undici.globalDispatcher.2",
	"undici.globalDispatcher.1",
]);

/**
 * Narrow a value read off the global dispatcher to something
 * `Reflect.construct` accepts. Exported so the narrowing is unit-testable: at
 * the call site every rejected shape funnels into the same `undefined`, which
 * makes the branch unobservable from `createHttp1Dispatcher` alone.
 *
 * @param value - The candidate `constructor` read off the global dispatcher.
 * @returns Whether the value can be constructed.
 */
export function isAgentConstructor(value: unknown): value is AgentConstructor {
	return typeof value === "function";
}

/**
 * Builds a request dispatcher that negotiates HTTP/1.1 only, by reusing the
 * class of the runtime's own global dispatcher.
 *
 * From Node 26 (undici 8) `fetch` offers h2 in ALPN, which defeats the
 * `connection: close` an upload sets: `connection` is a connection-specific
 * header, so an h2 transport drops it before the wire and pools every upload
 * onto one multiplexed session. One session death then fails every upload in
 * flight. Constructing the same agent with `allowH2: false` restores the
 * per-upload connection the directive was written for.
 *
 * There is no standard `fetch` option for this, so the agent is reached
 * through undici's versioned global symbol and its class rather than through
 * an import — which keeps the package dependency-free. The contract is
 * internal, so every step is guarded: an absent symbol, a non-constructible
 * value, or a constructor that throws all yield `undefined`, and the caller
 * sends the request unmodified.
 *
 * @param scope - The object to read the global dispatcher from. Defaults to
 *   `globalThis`; injectable so tests need not mutate the real global.
 * @returns A dispatcher restricted to HTTP/1.1, or `undefined` when this
 *   runtime offers no reachable one.
 */
export function createHttp1Dispatcher(scope: object = globalThis): object | undefined {
	for (const key of GLOBAL_DISPATCHER_KEYS) {
		const dispatcher = constructHttp1(Reflect.get(scope, Symbol.for(key)));
		if (dispatcher !== undefined) {
			return dispatcher;
		}
	}

	return undefined;
}

/**
 * Reconstructs `agent`'s class with h2 disabled.
 *
 * Most ways `agent` can be wrong already throw: `Reflect.get` rejects a
 * primitive, `null`, and an absent key, and `Reflect.construct` rejects a
 * `constructor` that is not one, or that refuses the options. One shape gets
 * through — a plain object, whose `constructor` is `Object`, so constructing
 * it hands back the options bag. The result is therefore checked against the
 * one part of undici's surface that is public and stable: a `Dispatcher`
 * exposes `dispatch`.
 *
 * @param agent - The candidate global dispatcher; any value, since it comes
 *   from an undocumented global.
 * @returns The new dispatcher, or `undefined` when `agent` is not an object
 *   whose constructor accepts undici's agent options.
 */
function constructHttp1(agent: unknown): object | undefined {
	try {
		// No shape guard ahead of this: `Reflect.get` already rejects a
		// primitive, `null`, and an absent key, so every malformed value lands
		// in the same catch.
		const agentClass = Reflect.get(agent, "constructor");
		if (!isAgentConstructor(agentClass)) {
			return undefined;
		}

		const dispatcher = Reflect.construct(agentClass, [{ allowH2: false }]);
		return typeof Reflect.get(dispatcher, "dispatch") === "function" ? dispatcher : undefined;
	} catch {
		// An internal contract that moved under us is not worth failing a
		// deploy over: fall back to the runtime's default transport.
		return undefined;
	}
}
