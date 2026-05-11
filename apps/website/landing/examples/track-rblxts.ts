import { diff, type Operation } from "@bedrock-rbx/core";

/**
 * Pure plan check: wrap any step from the reconcile loop yourself.
 * No network call; `diff` is sync.
 *
 * @param desired - Desired-state snapshot from `buildDesired`.
 * @param current - Current-state snapshot from your state backend.
 * @returns Only the operations that change something.
 */
export function planChanges(
	desired: Parameters<typeof diff>[0],
	current: Parameters<typeof diff>[1],
): ReadonlyArray<Operation> {
	const ops = diff(desired, current);
	return ops.filter((op) => op.type !== "noop");
}
