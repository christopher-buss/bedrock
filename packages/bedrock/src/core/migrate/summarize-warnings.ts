import type { MigrationSummary, MigrationWarning } from "./migration-report.ts";

const ZERO_SUMMARY: MigrationSummary = {
	ambiguousCount: 0,
	blockedCount: 0,
	deferredCount: 0,
	interpretiveCount: 0,
};

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
	return warnings.reduce<MigrationSummary>((accumulator, warning) => {
		return {
			...accumulator,
			[`${warning.kind}Count`]: accumulator[`${warning.kind}Count`] + 1,
		};
	}, ZERO_SUMMARY);
}
