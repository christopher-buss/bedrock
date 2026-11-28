import type { LuauExecutionTask } from "../../domains/cloud-v2/luau-execution-tasks/types.ts";

/**
 * Reports whether a Luau task can no longer change execution state.
 *
 * @param task - Task whose state should be classified.
 * @returns Whether the task is complete, failed, or cancelled.
 */
export function isTerminalTask(task: LuauExecutionTask): boolean {
	return task.state === "COMPLETE" || task.state === "FAILED" || task.state === "CANCELLED";
}
