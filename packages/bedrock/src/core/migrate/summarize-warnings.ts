import type { MigrationSummary, MigrationWarning } from "./migration-report.ts";

/**
 * Fold a `MigrationWarning` array into a `MigrationSummary` so the
 * report's aggregate counts are derived from the warning list rather
 * than maintained in parallel. Future warning-emitting slices thread
 * through this helper instead of having to remember to update the
 * summary at every emission site.
 *
 * @param warnings - Warnings to aggregate; the empty array yields a
 *   zeroed summary.
 * @returns Per-kind counts.
 */
export function summarizeWarnings(warnings: ReadonlyArray<MigrationWarning>): MigrationSummary {
	return {
		ambiguousCount: countOfKind(warnings, "ambiguous"),
		blockedCount: countOfKind(warnings, "blocked"),
		deferredCount: countOfKind(warnings, "deferred"),
		interpretiveCount: countOfKind(warnings, "interpretive"),
	};
}

function countOfKind(
	warnings: ReadonlyArray<MigrationWarning>,
	kind: MigrationWarning["kind"],
): number {
	return warnings.filter((warning) => warning.kind === kind).length;
}
