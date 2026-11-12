import type { OutOfBandEdit } from "./live-state.ts";
import type { Operation } from "./operations.ts";

/**
 * Label updates that restore fields changed outside bedrock.
 * @param ops - Plan computed against Live state.
 * @param edits - Differences from saved Current state.
 * @returns The same operation types, with a reporting reason on reverts.
 */
export function annotateReverts(
	ops: ReadonlyArray<Operation>,
	edits: ReadonlyArray<OutOfBandEdit>,
): ReadonlyArray<Operation> {
	return ops.map((op) => {
		if (op.type !== "update") {
			return op;
		}

		const reverts = edits.some((edit) => {
			return (
				edit.kind === op.desired.kind &&
				edit.key === op.key &&
				edit.fields.some(({ field }) => op.changedFields.includes(field))
			);
		});
		return reverts ? { ...op, reason: "outOfBandEdit" } : op;
	});
}
