import type { Result } from "@bedrock/ocale";

import type { BedrockState, StateError } from "../core/state.ts";

/**
 * Plugin contract for persisting deployment state: the interface an adapter
 * (Gist, local filesystem, cloud object store) implements to let Bedrock load
 * and save its per-environment {@link BedrockState} snapshot.
 *
 * `StatePort` is a *driven* (secondary) port in hexagonal terms, following the
 * same naming convention as {@link "./resource-driver".ResourceDriver}.
 *
 * @example
 *
 * ```ts
 * import type { BedrockState, StatePort } from "@bedrock/core";
 *
 * const store = new Map<string, BedrockState>();
 *
 * const statePort: StatePort = {
 *     async read(environment) {
 *         return { data: store.get(environment), success: true };
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
 *             expect(firstRead.data).toBeUndefined();
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
 *         if (secondRead.success && secondRead.data !== undefined) {
 *             expect(secondRead.data.environment).toBe("production");
 *             expect(secondRead.data.resources).toBeEmpty();
 *         }
 *     });
 * ```
 */
export interface StatePort {
	/**
	 * Reads state for the given environment.
	 *
	 * - Returns `Ok(undefined)` when no state file exists (legitimate first deploy).
	 * - Returns `Err(StateError)` when a file exists but cannot be parsed
	 *   (corrupt JSON, schema failure, unknown `$bedrock.version`).
	 *
	 * Never silently falls back to empty state: a malformed file that collapsed
	 * to `{ resources: [] }` would cause the next apply to re-create every
	 * resource on Roblox.
	 */
	read(environment: string): Promise<Result<BedrockState | undefined, StateError>>;

	/** Writes state for the given environment, overwriting any existing file. */
	write(state: BedrockState): Promise<Result<void, StateError>>;
}
