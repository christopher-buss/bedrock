import type { UniverseOutputs } from "../resources.ts";
import type { UniverseEntry } from "../schema.ts";
import type { MigrationWarning } from "./migration-report.ts";

/**
 * Output of one fold rule contributing to the eventual `UniverseEntry`.
 * The orchestrator (`foldUniverse`) composes fragments by spreading
 * `entryFragment` into the final entry, spreading `outputsFragment` into
 * the matching `BedrockState` resource's `outputs`, and concatenating
 * `warnings`. Most rules contribute only to the entry; rules that also
 * carry Roblox-assigned identifiers (icons, thumbnails) fill
 * `outputsFragment`. The `mergeFragment` helper, used inside individual
 * fold modules to combine sub-fragments, only merges `entryFragment` and
 * `warnings` because no rule that uses it currently produces outputs.
 */
export interface FoldFragment {
	/** Subset of universe fields this rule populated (empty when the rule did not fire). */
	readonly entryFragment: Partial<UniverseEntry>;
	/** Subset of universe outputs this rule populated; absent when the rule contributes no Roblox-assigned identifiers. */
	readonly outputsFragment?: Partial<UniverseOutputs>;
	/** Diagnostics this rule emitted. */
	readonly warnings: ReadonlyArray<MigrationWarning>;
}

/** Sentinel value for fold rules that produced neither output nor warnings. */
export const EMPTY_FRAGMENT: FoldFragment = { entryFragment: {}, warnings: [] };

/**
 * One row in a static blocked-field table: the Mantle field name and the
 * upstream limitation reason that the migrator surfaces verbatim in the
 * warning's `reason` slot. Used by folds that emit one `blocked`
 * `MigrationWarning` per non-`undefined` legacy-only field.
 */
export interface BlockedFieldRule {
	/** Mantle input key to test for non-`undefined`. */
	readonly field: string;
	/** Human-readable reason naming the upstream limitation. */
	readonly reason: string;
}

/**
 * Required fields for an `interpretive` warning, gathered as a single
 * argument so this builder stays under the project's max-params cap.
 */
interface InterpretiveWarningSpec {
	/** Path the migrator wrote in the bedrock config. */
	readonly bedrockPath: string;
	/** Resource-rooted Mantle path the rule consumed. */
	readonly mantlePath: string;
	/** Stable rule identifier audited in the migration report. */
	readonly rule: string;
}

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
 * Does not merge `outputsFragment`; outputs composition is handled by
 * `foldUniverse` across the whole fragment list, not by this helper.
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

/**
 * Build an `interpretive` `MigrationWarning`. Used by every fold rule that
 * applies a documented mapping; the report consumer narrows on `kind`.
 *
 * @param spec - The bedrock path, mantle path, and rule identifier.
 * @returns A `MigrationWarning` with `kind: "interpretive"`.
 */
export function interpretiveWarning(spec: InterpretiveWarningSpec): MigrationWarning {
	return {
		bedrockPath: spec.bedrockPath,
		kind: "interpretive",
		mantlePath: spec.mantlePath,
		rule: spec.rule,
	};
}

/**
 * Build a `blocked` `MigrationWarning`. Used when no Open Cloud writable
 * endpoint exists for the field the migrator encountered.
 *
 * @param mantlePath - Resource-rooted Mantle path of the blocked field.
 * @param reason - Human-readable reason describing what is unsupported.
 * @returns A `MigrationWarning` with `kind: "blocked"`.
 */
export function blockedWarning(mantlePath: string, reason: string): MigrationWarning {
	return { kind: "blocked", mantlePath, reason };
}

/**
 * Build an `ambiguous` `MigrationWarning`. Used when a value is mappable
 * but unsafe to act on without user input; the hint guides the next step.
 *
 * @param mantlePath - Resource-rooted Mantle path of the ambiguous field.
 * @param hint - Human-readable suggestion for resolving the ambiguity.
 * @returns A `MigrationWarning` with `kind: "ambiguous"`.
 */
export function ambiguousWarning(mantlePath: string, hint: string): MigrationWarning {
	return { hint, kind: "ambiguous", mantlePath };
}
