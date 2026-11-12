import { planIntents } from "./index.ts";
import type { IntentInput, IntentPlan } from "./index.ts";

/** Immutable PR data used by the writer. */
export interface ReconcileState {
	/** Current owned file bytes. */
	actual: string | undefined;
	/** Observed base commit. */
	base: string;
	/** Observed PR head commit. */
	head: string;
	/** Immutable dependency input. */
	input: IntentInput;
	/** Verified test merge parents. */
	mergeParents: Array<string>;
	/** Whether only verified writer commits touched the owned file. */
	owned: boolean;
}

/** Conditional signed update to the one reserved intent path. */
export interface IntentWrite {
	/** Desired file bytes, or deletion. */
	content: string | undefined;
	/** Observed PR head commit. */
	head: string;
	/** Reserved intent file path. */
	path: string;
}

/** Reads immutable inputs and performs conditional GitHub writes. */
export interface ReconcilePort {
	/** Read one immutable PR snapshot. */
	read: () => Promise<ReconcileState>;
	/** Append a signed conditional commit. */
	write: (change: IntentWrite) => Promise<void>;
}

/** A conditional write lost a race with a newer PR head. */
export class HeadChangedError extends Error {}

/**
 * Reconciles only after validating ownership, policy and current refs.
 * @param port - Immutable GitHub reader and conditional writer.
 * @param write - Whether to apply the computed intent.
 * @returns The decision and generated plan.
 * @rejects When ownership, refs or release policy need manual recovery.
 */
export async function reconcileAsync(
	port: ReconcilePort,
	write: boolean,
): Promise<{
	kind: "proposed" | "unchanged" | "written";
	plan: IntentPlan;
}> {
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const state = await port.read();
		assertWritable(state);
		const plan = planIntents(state.input);
		if (write && plan.review.length > 0) {
			throw new Error(plan.review.join("\n"));
		}

		if (state.actual === plan.content) {
			return { kind: "unchanged", plan };
		}

		if (!write) {
			return { kind: "proposed", plan };
		}

		const current = await port.read();
		if (current.base !== state.base || current.head !== state.head) {
			continue;
		}

		const written = await attemptWriteAsync(port, {
			content: plan.content,
			head: state.head,
			path: `.changeset/renovate-pr-${state.input.number}.md`,
		});
		if (!written) {
			continue;
		}

		return { kind: "written", plan };
	}

	throw new Error("PR refs keep changing; dispatch the writer again");
}

function assertWritable(state: ReconcileState): void {
	if (!state.owned) {
		throw new Error("Reserved intent edited outside writer; move it to a human filename");
	}

	if (
		state.mergeParents.length !== 2 ||
		state.mergeParents[0] !== state.base ||
		state.mergeParents[1] !== state.head
	) {
		throw new Error("Test merge is unavailable or stale; retry after GitHub refreshes it");
	}
}

async function attemptWriteAsync(port: ReconcilePort, change: IntentWrite): Promise<boolean> {
	try {
		await port.write(change);
		return true;
	} catch (err) {
		if (err instanceof HeadChangedError) {
			return false;
		}

		throw err;
	}
}
