import { evaluateGate } from "./gate.ts";
import { planIntents } from "./index.ts";
import type { ReconcileState } from "./reconcile.ts";

/**
 * Compare the immutable API snapshot with the merge checkout being tested.
 * @param state - GitHub observations.
 * @param checkout - Checkout parents and pnpm-selected versioned packages.
 * @returns Semantic diagnostics; coverage is checked separately by the existing job.
 */
export function validateGateSnapshot(
	state: ReconcileState,
	checkout: { base: string; head: string; selected: Array<string> },
): Array<string> {
	if (
		state.base !== checkout.base ||
		state.head !== checkout.head ||
		state.mergeParents.join(" ") !== `${checkout.base} ${checkout.head}`
	) {
		return ["PR snapshot advanced or merge parents differ; rerun the changeset check"];
	}

	const plan = planIntents(state.input);
	return evaluateGate({
		actual: state.actual,
		affected: plan.affected,
		covered: checkout.selected,
		desired: plan.content,
		enforce: true,
		owned: state.owned,
		renovate: true,
		review: plan.review,
		selected: checkout.selected,
	}).errors;
}
