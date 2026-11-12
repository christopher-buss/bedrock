/** Combined commit status from the GitHub API. */
export interface CombinedStatus {
	/** Latest status per context. */
	statuses: Array<{ context: string; state: string }>;
}

/** A PR commit as listed by the compare API. */
interface HistoryCommit {
	/** GitHub account that authored the commit, when linked. */
	author: null | { login: string };
	/** Commit SHA. */
	sha: string;
}

/**
 * Report whether Renovate's latest commit carries a failed artifact update.
 * The writer's commit becomes the PR head, so the status is read from
 * Renovate's own commit, not the head.
 * @param commits - PR history, oldest first.
 * @param readStatus - Reads one 100-entry page of a commit's combined status.
 * @returns Whether `renovate/artifacts` failed.
 * @rejects {Error} When the statuses exceed 10 pages.
 */
export async function artifactsFailedAsync(
	commits: ReadonlyArray<HistoryCommit>,
	readStatus: (sha: string, query: string) => Promise<CombinedStatus>,
): Promise<boolean> {
	const renovate = commits.findLast((entry) => entry.author?.login === "renovate[bot]");
	if (renovate === undefined) {
		return false;
	}

	for (let page = 1; page <= 10; page += 1) {
		const { statuses } = await readStatus(renovate.sha, `per_page=100&page=${page}`);
		const failed = statuses.some(({ context, state }) => {
			return context === "renovate/artifacts" && state === "failure";
		});
		if (failed || statuses.length < 100) {
			return failed;
		}
	}

	throw new Error("Commit status pagination exceeded safe limit");
}

/**
 * Read every page of a compare-API commit list.
 * @template T - Commit shape returned by the API.
 * @param json - Reads one GitHub API resource.
 * @param resource - Compare resource without paging query.
 * @returns All commits, oldest first.
 * @rejects {Error} When the history exceeds 100 pages.
 */
export async function historyAsync<T>(
	json: (resource: string) => Promise<{ commits: Array<T> }>,
	resource: string,
): Promise<Array<T>> {
	const entries: Array<T> = [];
	for (let page = 1; page <= 100; page += 1) {
		const batch = await json(`${resource}?per_page=100&page=${page}`);
		entries.push(...batch.commits);
		if (batch.commits.length < 100) {
			return entries;
		}
	}

	throw new Error("GitHub pagination exceeded safe limit");
}
