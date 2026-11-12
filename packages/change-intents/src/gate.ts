/** Observations from the planner and the existing coverage gate. */
export interface GateInput {
	/** Current reserved-file bytes. */
	actual: string | undefined;
	/** Planner-selected versioned consumers. */
	affected: Array<string>;
	/** Packages named by PR-added intent frontmatter. */
	covered: Array<string>;
	/** Canonical reserved-file bytes. */
	desired: string | undefined;
	/** Whether semantic failures block the gate. */
	enforce: boolean;
	/** Verified writer ownership, or an absent reserved file. */
	owned: boolean;
	/** Whether this PR was authored by Renovate. */
	renovate: boolean;
	/** Unresolved planner decisions. */
	review: Array<string>;
	/** Pnpm-selected versioned packages. */
	selected: Array<string>;
}

/**
 * Preserve explicit coverage and optionally enforce Renovate intent semantics.
 * @param input - Immutable observations for the tested merge snapshot.
 * @returns Blocking errors and shadow diagnostics.
 */
export function evaluateGate(input: GateInput): {
	diagnostics: Array<string>;
	errors: Array<string>;
} {
	const missing = input.selected.filter((name) => !input.covered.includes(name));
	const errors = missing.map((name) => `No change intent covers: ${name}`);
	const diagnostics = input.renovate ? semanticErrors(input) : [];
	return { diagnostics, errors: [...errors, ...(input.enforce ? diagnostics : [])] };
}

function semanticErrors(input: GateInput): Array<string> {
	const diagnostics = [...input.review];
	if (JSON.stringify(input.selected.toSorted()) !== JSON.stringify(input.affected.toSorted())) {
		diagnostics.push("pnpm and intent planner select different versioned packages");
	}

	if (!input.owned) {
		diagnostics.push(
			"Reserved intent has foreign ownership; move human edits to another intent filename",
		);
	}

	if (input.actual !== input.desired) {
		diagnostics.push("Generated intent is missing, stale or obsolete");
	}

	return diagnostics;
}
