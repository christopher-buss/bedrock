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
 * @param readStatus - Reads the combined status of one commit.
 * @returns Whether `renovate/artifacts` failed.
 */
export async function artifactsFailedAsync(
	commits: ReadonlyArray<HistoryCommit>,
	readStatus: (sha: string) => Promise<CombinedStatus>,
): Promise<boolean> {
	const renovate = commits.findLast((entry) => entry.author?.login === "renovate[bot]");
	if (renovate === undefined) {
		return false;
	}

	const { statuses } = await readStatus(renovate.sha);
	return statuses.some(({ context, state }) => {
		return context === "renovate/artifacts" && state === "failure";
	});
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
