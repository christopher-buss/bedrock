import type { BedrockState } from "./state.ts";

/**
 * Serialize a {@link BedrockState} to the on-disk JSON representation used by
 * state-port adapters.
 *
 * The on-disk shape wraps the in-memory state with a
 * `$bedrock: { version: N }` envelope so that a future breaking change to the
 * schema can be detected and rejected at parse time rather than silently
 * accepted. The top-level `version` field is not duplicated on disk.
 *
 * @example
 *
 * ```ts
 * import { serializeStateFile, type BedrockState } from "@bedrock/core";
 *
 * const state: BedrockState = {
 *     environment: "production",
 *     resources: [],
 *     version: 1,
 * };
 *
 * const wire = serializeStateFile(state);
 * expect(JSON.parse(wire)).toStrictEqual({
 *     $bedrock: { version: 1 },
 *     environment: "production",
 *     resources: [],
 * });
 * ```
 *
 * @param state - The in-memory state snapshot to serialize.
 * @returns A pretty-printed JSON string ready to hand to a state adapter's write method.
 */
export function serializeStateFile(state: BedrockState): string {
	const envelope = {
		$bedrock: { version: state.version },
		environment: state.environment,
		resources: state.resources,
	};
	return JSON.stringify(envelope, undefined, 2);
}
