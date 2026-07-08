import { commitBack } from "./commit-back.ts";
import type { CommitBackOptions } from "./commit-back.ts";
import type { GitExec } from "./git.ts";

const DEFAULT_BRANCH = "main";
const DEFAULT_MESSAGE = "chore(assets): regenerate asset ids [skip ci]";
const DEFAULT_AUTHOR_NAME = "github-actions[bot]";
const DEFAULT_AUTHOR_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";
const DEFAULT_SERVER_URL = "https://github.com";
const WHITESPACE_PATTERN = /\s+/u;

/** `git config --unset-all` exit code meaning the key was not set. */
const EXIT_CODE_CONFIG_KEY_ABSENT = 5;

/**
 * The slice of `@actions/core` the action shell uses, narrowed so tests can
 * inject a fake without the real toolkit.
 */
export interface ActionIo {
	/** Reads an action input by kebab-case name, returning `""` when unset. */
	readonly getInput: (name: string) => string;
	/** Marks the action failed with the given message. */
	readonly setFailed: (message: string) => void;
	/** Records an action output. */
	readonly setOutput: (name: string, value: string) => void;
	/** Registers a value to be masked in the workflow logs. */
	readonly setSecret: (value: string) => void;
}

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

/** Dependencies for {@link executeCommitBackAction}, the action composition root. */
interface ExecuteCommitBackActionDependencies {
	/** The process environment to read workflow vars from. */
	readonly environment: Record<string, string | undefined>;
	/** The git runner the reflow drives; the live shim injects the real adapter. */
	readonly git: GitExec;
	/** The `@actions/core` slice: inputs, outputs, masking, and failure. */
	readonly io: ActionIo;
}

/**
 * Resolve the action's inputs into a commit-back plan plus the token-authenticated
 * `origin` URL the push authenticates through.
 *
 * @param deps - Input and env readers.
 * @returns The commit-back options, the authenticated remote URL, and the git
 * config key `actions/checkout` persists its credentials under.
 * @rejects When a required input (`token`, `paths`) or env (`GITHUB_REPOSITORY`)
 * is missing, or `max-attempts` is not a positive integer.
 */
export function resolveActionConfig(deps: CommitBackActionDeps): {
	extraheaderKey: string;
	options: CommitBackOptions;
	remoteUrl: string;
} {
	const token = requireInput(deps.readInput, "token");
	// requireInput trims, so the split yields no leading/trailing empties.
	const paths = requireInput(deps.readInput, "paths").split(WHITESPACE_PATTERN);
	const serverUrl = deps.getEnv("GITHUB_SERVER_URL") ?? DEFAULT_SERVER_URL;
	const repo = requireEnvironment(deps.getEnv, "GITHUB_REPOSITORY");
	const { origin: serverOrigin } = new URL(serverUrl);

	return {
		// The same key actions/checkout persists its (read-only) credentials
		// under: URL origin, so a trailing slash or path in the env normalizes.
		extraheaderKey: `http.${serverOrigin}/.extraheader`,
		options: {
			authorEmail: optionalInput(deps.readInput("author-email"), DEFAULT_AUTHOR_EMAIL),
			authorName: optionalInput(deps.readInput("author-name"), DEFAULT_AUTHOR_NAME),
			branch: optionalInput(deps.readInput("branch"), DEFAULT_BRANCH),
			message: optionalInput(deps.readInput("message"), DEFAULT_MESSAGE),
			paths,
			...parseMaxAttempts(deps.readInput("max-attempts")),
		},
		remoteUrl: authenticatedUrl({ repository: repo, serverUrl, token }),
	};
}

/**
 * Run the commit-back GitHub Action: authenticate `origin` with the supplied
 * token, clear any credentials `actions/checkout` persisted (they would
 * override the URL credentials), reflow the generated paths onto the branch
 * tip, and record the `committed`, `changed-files`, and `sha` outputs.
 *
 * @param deps - Injected git runner, input/env readers, and output sink.
 * @rejects When configuration is invalid or the push exhausts its attempts.
 */
export async function runCommitBackAction(deps: CommitBackActionDeps): Promise<void> {
	const { extraheaderKey, options, remoteUrl } = resolveActionConfig(deps);
	const urlResult = await deps.git(["remote", "set-url", "origin", remoteUrl]);
	if (urlResult.code !== 0) {
		// The error omits remoteUrl, which embeds the token.
		throw new Error(`commit-back: failed to set the origin URL (exit code ${urlResult.code})`);
	}

	// actions/checkout with persist-credentials: true (its default) stores the
	// workflow's read-only GITHUB_TOKEN as an http.extraheader, which overrides
	// the URL credentials and 403s every push. Clear it defensively; exit code 5
	// just means checkout persisted nothing.
	const unset = await deps.git(["config", "--unset-all", extraheaderKey]);
	if (unset.code !== 0 && unset.code !== EXIT_CODE_CONFIG_KEY_ABSENT) {
		throw new Error(
			`commit-back: failed to clear the persisted http.extraheader (exit code ${unset.code})`,
		);
	}

	const result = await commitBack({ git: deps.git }, options);
	deps.setOutput("committed", String(result.committed));
	deps.setOutput("changed-files", String(result.changedFiles));
	deps.setOutput("sha", result.sha ?? "");
}

/**
 * The action's composition root: mask the token, wire the toolkit and process
 * env into {@link runCommitBackAction}, and convert any failure into
 * `setFailed`. Kept here (rather than the bundler entrypoint) so it is fully
 * tested; `main.ts` only supplies the real `@actions/core`, `process.env`, and
 * git adapter.
 *
 * @param deps - The `@actions/core` slice, process environment, and git runner.
 */
export async function executeCommitBackAction(
	deps: ExecuteCommitBackActionDependencies,
): Promise<void> {
	const { environment, git, io } = deps;
	io.setSecret(io.getInput("token"));
	try {
		await runCommitBackAction({
			getEnv: (name) => environment[name],
			git,
			readInput: io.getInput,
			setOutput: io.setOutput,
		});
	} catch (err) {
		io.setFailed(err instanceof Error ? err.message : String(err));
	}
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

function optionalInput(raw: string, fallback: string): string {
	// Trim like requireInput so a whitespace-only value falls back to the default
	// rather than producing an all-spaces branch, message, or author field.
	const value = raw.trim();
	return value === "" ? fallback : value;
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
