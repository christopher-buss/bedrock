import type { LuauExecutionTaskWire } from "#src/domains/cloud-v2/luau-execution-tasks/wire";

/**
 * Builds a minimally-valid {@link LuauExecutionTaskWire} body for an
 * in-progress task. Pass an `overrides` object to tweak fields without
 * re-stating the defaults.
 *
 * @param overrides - Fields to override on the default body.
 * @returns A valid wire body with the overrides applied.
 */
export function validInProgressTaskBody(
	overrides: Partial<LuauExecutionTaskWire> = {},
): LuauExecutionTaskWire {
	return {
		createTime: "2026-01-01T00:00:00Z",
		path: "universes/123/places/456/luau-execution-session-tasks/task-1",
		state: "QUEUED",
		updateTime: "2026-01-01T00:00:30Z",
		user: "user-1",
		...overrides,
	};
}
