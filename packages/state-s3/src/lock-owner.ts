import type { StateBackendContext } from "@bedrock-rbx/core";

// What a hold is recorded as when nothing in the environment names the run.
// A blocked deploy still reports the object and the instant, so an
// unnameable holder narrows the search rather than ending it.
const ANONYMOUS = "unknown";

/**
 * Name the run taking a hold, so a deploy blocked behind it can say who it
 * is waiting on.
 *
 * `BEDROCK_LOCK_OWNER` is read first, because a team running deploys from
 * somewhere neither of the other two readings covers needs a way to say so.
 * A GitHub Actions run names itself with the URL of the run, which is the
 * one string that leads an operator straight to the job holding the
 * **Environment**. Anything else falls back to the local user.
 *
 * @param getEnvironment - Reads an environment variable.
 * @returns Who the hold is recorded as belonging to.
 */
export function lockOwnerFrom(getEnvironment: StateBackendContext["getEnv"]): string {
	const declared = getEnvironment("BEDROCK_LOCK_OWNER");
	if (declared !== undefined && declared !== "") {
		return declared;
	}

	const run = getEnvironment("GITHUB_RUN_ID");
	if (run !== undefined && run !== "") {
		const repo = getEnvironment("GITHUB_REPOSITORY") ?? ANONYMOUS;
		return `https://github.com/${repo}/actions/runs/${run}`;
	}

	return getEnvironment("USER") ?? getEnvironment("USERNAME") ?? ANONYMOUS;
}
