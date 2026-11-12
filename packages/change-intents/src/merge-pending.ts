import type { ReconcileState } from "./reconcile.ts";

/** GitHub is still computing the candidate for the observed PR refs. */
export class MergePendingError extends Error {}

/**
 * Poll only transient test-merge readiness, preserving every fatal failure.
 * @param read - Reader that recaptures PR refs on each attempt.
 * @returns A ready immutable PR snapshot.
 * @rejects When readiness stays pending or any fatal read fails.
 */
export async function readReadyMergeAsync(
	read: () => Promise<ReconcileState>,
): Promise<ReconcileState> {
	for (let attempt = 0; ; attempt += 1) {
		try {
			return await read();
		} catch (err) {
			if (!(err instanceof MergePendingError) || attempt >= 2) {
				throw err;
			}

			await new Promise<void>((resolve) => {
				setTimeout(resolve, 1000);
			});
		}
	}
}
