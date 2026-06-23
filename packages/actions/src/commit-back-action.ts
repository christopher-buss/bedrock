import { commitBack } from "./commit-back.ts";
import type { CommitBackOptions } from "./commit-back.ts";
import type { GitExec } from "./git.ts";

const DEFAULT_BRANCH = "main";
const DEFAULT_MESSAGE = "chore(assets): regenerate asset ids [skip ci]";
const DEFAULT_AUTHOR_NAME = "github-actions[bot]";
const DEFAULT_AUTHOR_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";
const DEFAULT_SERVER_URL = "https://github.com";

/** Dependencies for {@link runCommitBackAction}, all injected for testability. */
export interface CommitBackActionDeps {
	/** Reads a GitHub workflow env var (e.g. `GITHUB_REPOSITORY`); `undefined` when absent. */
	readonly getEnv: (name: string) => string | undefined;
	/** Runs `git`; the live shim injects the real git adapter. */
	readonly git: GitExec;
	/** Reads an action input by kebab-case name, returning `""` when unset. */
	readonly readInput: (name: string) => string;
	/** Records an action output. */
	readonly setOutput: (name: string, value: string) => void;
}

/**
 * Resolve the action's inputs into a commit-back plan plus the token-authenticated
 * `origin` URL the push authenticates through.
 *
 * @param deps - Input and env readers.
 * @returns The commit-back options and the authenticated remote URL.
 * @rejects When a required input (`token`, `paths`) or env (`GITHUB_REPOSITORY`)
 * is missing, or `max-attempts` is not a positive integer.
 */
export function resolveActionConfig(deps: CommitBackActionDeps): {
	options: CommitBackOptions;
	remoteUrl: string;
} {
	const token = requireInput(deps.readInput, "token");
	// requireInput trims, so the split yields no leading/trailing empties.
	const paths = requireInput(deps.readInput, "paths").split(/\s+/u);
	const serverUrl = deps.getEnv("GITHUB_SERVER_URL") ?? DEFAULT_SERVER_URL;
	const repository = requireEnvironment(deps.getEnv, "GITHUB_REPOSITORY");

	return {
		options: {
			authorEmail: deps.readInput("author-email") || DEFAULT_AUTHOR_EMAIL,
			authorName: deps.readInput("author-name") || DEFAULT_AUTHOR_NAME,
			branch: deps.readInput("branch") || DEFAULT_BRANCH,
			message: deps.readInput("message") || DEFAULT_MESSAGE,
			paths,
			...parseMaxAttempts(deps.readInput("max-attempts")),
		},
		remoteUrl: authenticatedUrl({ repository, serverUrl, token }),
	};
}

/**
 * Run the commit-back GitHub Action: authenticate `origin` with the supplied
 * token, reflow the generated paths onto the branch tip, and record the
 * `committed`, `changed-files`, and `sha` outputs.
 *
 * @param deps - Injected git runner, input/env readers, and output sink.
 * @rejects When configuration is invalid or the push exhausts its attempts.
 */
export async function runCommitBackAction(deps: CommitBackActionDeps): Promise<void> {
	const { options, remoteUrl } = resolveActionConfig(deps);
	const setUrl = await deps.git(["remote", "set-url", "origin", remoteUrl]);
	if (setUrl.code !== 0) {
		// The error omits remoteUrl, which embeds the token.
		throw new Error(`commit-back: failed to set the origin URL (exit code ${setUrl.code})`);
	}

	const result = await commitBack({ git: deps.git }, options);
	deps.setOutput("committed", String(result.committed));
	deps.setOutput("changed-files", String(result.changedFiles));
	deps.setOutput("sha", result.sha ?? "");
}

function authenticatedUrl(parts: { repository: string; serverUrl: string; token: string }): string {
	// URL parsing (over string surgery) tolerates a trailing slash, a custom
	// scheme, or a path in GITHUB_SERVER_URL, and encodes the credentials.
	const url = new URL(parts.serverUrl);
	url.username = "x-access-token";
	url.password = parts.token;
	url.pathname = `/${parts.repository}.git`;
	return url.href;
}

function parseMaxAttempts(raw: string): { maxAttempts?: number } {
	if (raw.trim() === "") {
		return {};
	}

	const value = Number(raw);
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`commit-back: 'max-attempts' must be a positive integer, got '${raw}'`);
	}

	return { maxAttempts: value };
}

function requireEnvironment(
	getEnvironment: (name: string) => string | undefined,
	name: string,
): string {
	const value = getEnvironment(name);
	if (value === undefined || value.trim() === "") {
		throw new Error(`commit-back: missing required environment variable '${name}'`);
	}

	return value;
}

function requireInput(readInput: (name: string) => string, name: string): string {
	const value = readInput(name).trim();
	if (value === "") {
		throw new Error(`commit-back: missing required input '${name}'`);
	}

	return value;
}
