import type { Result } from "@bedrock-rbx/ocale";

import type { BedrockState, StateError, StateRecord, StateVersion } from "../core/state.ts";

/**
 * Plugin contract for persisting deployment state: the interface an adapter
 * (Gist, local filesystem, cloud object store) implements to let Bedrock load
 * and save its per-environment {@link BedrockState} snapshot.
 *
 * `StatePort` is a *driven* (secondary) port in hexagonal terms, following the
 * same naming convention as {@link "./resource-driver".ResourceDriver}.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import type { BedrockState, StatePort } from "@bedrock-rbx/core";
 *
 * const store = new Map<string, BedrockState>();
 *
 * const statePort: StatePort = {
 *     async read(environment) {
 *         const state = store.get(environment);
 *         return { data: state === undefined ? {} : { state }, success: true };
 *     },
 *     async write(state) {
 *         store.set(state.environment, state);
 *         return { data: undefined, success: true };
 *     },
 * };
 *
 * return statePort
 *     .read("production")
 *     .then((firstRead) => {
 *         expect(firstRead.success).toBeTrue();
 *         if (firstRead.success) {
 *             expect(firstRead.data.state).toBeUndefined();
 *         }
 *         return statePort.write({
 *             environment: "production",
 *             resources: [],
 *             version: 1,
 *         });
 *     })
 *     .then((writeResult) => {
 *         expect(writeResult.success).toBeTrue();
 *         return statePort.read("production");
 *     })
 *     .then((secondRead) => {
 *         expect(secondRead.success).toBeTrue();
 *         if (secondRead.success && secondRead.data.state !== undefined) {
 *             expect(secondRead.data.state.environment).toBe("production");
 *             expect(secondRead.data.state.resources).toBeEmpty();
 *         }
 *     });
 * ```
 */
export interface StatePort {
	/**
	 * Reads state for the given environment, together with the version
	 * naming the record it read.
	 *
	 * - Returns `Ok` with no `state` when no state file exists (legitimate
	 *   first deploy).
	 * - Returns `Ok` with no `version` when the backend's store has no
	 *   version primitive, which makes the next write unconditional.
	 * - Returns `Err(StateError)` when a file exists but cannot be parsed
	 *   (corrupt JSON, schema failure, unknown `$bedrock.version`).
	 *
	 * Never silently falls back to empty state: a malformed file that collapsed
	 * to `{ resources: [] }` would cause the next apply to re-create every
	 * resource on Roblox.
	 */
	read(environment: string): Promise<Result<StateRecord, StateError>>;

	/**
	 * Writes state for the given environment.
	 *
	 * Pass the `version` a `read` returned to fence the write against the
	 * record that read observed: a store whose record has moved since
	 * fails with a `stateConflict` rather than overwriting a write the
	 * caller never saw. That includes the case where the read found
	 * nothing, which fails if a record has appeared since.
	 *
	 * Passing no version overwrites whatever is there, which is what a
	 * backend with no version primitive can offer and what a deliberate
	 * operator-driven push wants.
	 */
	write(state: BedrockState, expected?: StateVersion): Promise<Result<void, StateError>>;
}
