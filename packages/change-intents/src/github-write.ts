import { Buffer } from "node:buffer";

import type { GithubFailure } from "./github-config.ts";
import type { IntentWrite } from "./reconcile.ts";

/**
 * Build the signed GitHub file mutation.
 * @param change - Desired update or removal.
 * @returns GraphQL file changes.
 */
export function fileChanges(change: IntentWrite): object {
	return change.content === undefined
		? { deletions: [{ path: change.path }] }
		: {
				additions: [
					{ contents: Buffer.from(change.content).toString("base64"), path: change.path },
				],
			};
}
/**
 * Recognize only the service's typed conditional-head conflict.
 * @param errors - GraphQL failures.
 * @returns Whether every error is a stale commit head.
 */
export function headConflict(errors: ReadonlyArray<GithubFailure>): boolean {
	return (
		errors.length > 0 &&
		errors.every(
			(error) => error.type === "STALE_DATA" && error.path?.[0] === "createCommitOnBranch",
		)
	);
}
