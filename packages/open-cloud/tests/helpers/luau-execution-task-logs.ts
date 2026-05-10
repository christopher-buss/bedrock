import type { ListLogsResponseWire } from "#src/domains/cloud-v2/luau-execution-task-logs/wire";

/**
 * Builds a minimally-valid {@link ListLogsResponseWire} body containing
 * one chunk with one structured message. Pass an `overrides` object to
 * tweak fields without re-stating the defaults.
 *
 * @param overrides - Fields to override on the default body.
 * @returns A valid wire body with the overrides applied.
 */
export function validLogPageBody(
	overrides: Partial<ListLogsResponseWire> = {},
): ListLogsResponseWire {
	return {
		luauExecutionSessionTaskLogs: [
			{
				path: "universes/123/places/456/versions/789/luau-execution-sessions/session-1/tasks/task-1/logs/chunk-1",
				structuredMessages: [
					{
						createTime: "2026-01-01T00:00:00Z",
						message: "Hello from Luau",
						messageType: "OUTPUT",
					},
				],
			},
		],
		...overrides,
	};
}
