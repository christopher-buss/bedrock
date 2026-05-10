import type { LuauExecutionTaskBinaryInputWire } from "#src/domains/cloud-v2/luau-execution-task-binary-inputs/wire";

/**
 * Builds a minimally-valid {@link LuauExecutionTaskBinaryInputWire} body
 * for tests. Pass an `overrides` object to tweak fields without re-stating
 * the defaults.
 *
 * @param overrides - Fields to override on the default body.
 * @returns A valid wire body with the overrides applied.
 */
export function validBinaryInputBody(
	overrides: Partial<LuauExecutionTaskBinaryInputWire> = {},
): LuauExecutionTaskBinaryInputWire {
	return {
		path: "universes/123/luau-execution-session-task-binary-inputs/abc",
		uploadUri: "https://storage.example.com/upload?token=xyz",
		...overrides,
	};
}
