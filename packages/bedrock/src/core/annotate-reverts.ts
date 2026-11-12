import type { Except } from "type-fest";

import type { RetiredInput } from "./flatten.ts";
import type { OutOfBandEdit } from "./live-state.ts";
import type { Operation, UpdateOperation } from "./operations.ts";
import type { ResourceCurrentState, ResourceDesiredState } from "./resources.ts";

interface Baseline {
	readonly desired: ReadonlyArray<ResourceDesiredState | RetiredInput>;
	readonly edits: ReadonlyArray<OutOfBandEdit>;
	readonly resources: ReadonlyArray<ResourceCurrentState>;
}

type IconRestoration = Except<UpdateOperation, "changedFields">;

/**
 * Label updates that restore fields changed outside bedrock.
 * @param ops - Plan computed against Live state.
 * @param baseline - Desired entries, edits and live resources, for icon-only noops.
 * @returns Updates with revert reporting and explicit icon upload instructions.
 */
export function annotateReverts(
	ops: ReadonlyArray<Operation>,
	baseline: Baseline,
): ReadonlyArray<Operation> {
	const { edits } = baseline;
	const icons = iconRestorations(edits, baseline);
	return ops.map((op) => {
		if (op.type === "noop" || op.type === "update") {
			const kind = op.type === "noop" ? op.kind : op.desired.kind;
			const icon = icons.get(`${kind}:${op.key}`);
			if (icon !== undefined) {
				return {
					...icon,
					changedFields:
						op.type === "update"
							? [...new Set([...op.changedFields, "icon"])]
							: ["icon"],
				};
			}
		}

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

function iconRestorations(
	edits: ReadonlyArray<OutOfBandEdit>,
	baseline: Baseline,
): ReadonlyMap<string, IconRestoration> {
	const edited = new Set(
		edits
			.filter((edit) => edit.fields.some(({ field }) => field === "icon"))
			.map(({ key, kind }) => `${kind}:${key}`),
	);
	const current = new Map(
		baseline.resources.map((resource) => [`${resource.kind}:${resource.key}`, resource]),
	);
	const updates = new Map<string, IconRestoration>();
	for (const desired of baseline.desired) {
		const identity = `${desired.kind}:${desired.key}`;
		const saved = current.get(identity);
		if (saved !== undefined && edited.has(identity) && "icon" in desired) {
			updates.set(identity, {
				key: desired.key,
				current: saved,
				desired,
				forceIconUpload: true,
				reason: "outOfBandEdit",
				type: "update",
			});
		}
	}

	return updates;
}
