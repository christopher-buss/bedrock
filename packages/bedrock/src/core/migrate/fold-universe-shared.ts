import type { UniverseEntry } from "../schema.ts";
import type { MigrationWarning } from "./migration-report.ts";

/**
 * Output of one fold rule contributing to the eventual `UniverseEntry`.
 * Fragments compose by spreading `entryFragment` into the final entry and
 * concatenating `warnings`.
 */
export interface FoldFragment {
	/** Subset of universe fields this rule populated (empty when the rule did not fire). */
	readonly entryFragment: Partial<UniverseEntry>;
	/** Diagnostics this rule emitted. */
	readonly warnings: ReadonlyArray<MigrationWarning>;
}

/** Sentinel value for fold rules that produced neither output nor warnings. */
export const EMPTY_FRAGMENT: FoldFragment = { entryFragment: {}, warnings: [] };

/**
 * Narrow a value to a plain object payload (rejects arrays, null, primitives).
 *
 * @param value - Value to test.
 * @returns `true` when `value` is a plain object record.
 */
export function isObjectPayload(value: unknown): value is Record<string, unknown> {
	return Object.prototype.toString.call(value) === "[object Object]";
}

/**
 * Combine two fragments, with the right-hand side overriding overlapping
 * `entryFragment` keys and its `warnings` appended after the left's.
 *
 * @param left - Earlier fragment.
 * @param right - Later fragment whose entry-fragment keys win on conflict.
 * @returns The merged fragment.
 */
export function mergeFragment(left: FoldFragment, right: FoldFragment): FoldFragment {
	return {
		entryFragment: { ...left.entryFragment, ...right.entryFragment },
		warnings: [...left.warnings, ...right.warnings],
	};
}
