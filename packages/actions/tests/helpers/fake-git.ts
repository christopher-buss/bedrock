import type { GitExec, GitResult } from "#src/git";

/**
 * The distinct `git` invocations the commit-back reflow makes, one label per
 * call shape. Tests answer a fake by naming the command rather than matching
 * on the raw argument vector.
 */
export type GitCommand =
	| "add"
	| "checkout"
	| "commit"
	| "configList"
	| "configUnsetExtraheader"
	| "configUnsetInclude"
	| "diff"
	| "fetch"
	| "push"
	| "remoteSetUrl"
	| "revParse"
	| "stashCreate"
	| "status";

/**
 * Canned answers for {@link fakeGit}, keyed by {@link GitCommand}. A single
 * {@link GitResult} answers every invocation of that command; an array is
 * consumed in order and its final entry repeats once exhausted, which models
 * "fails once, then succeeds" and "fails forever" without a mutable counter in
 * the test.
 */
export type GitResponses = Partial<Record<GitCommand, GitResult | ReadonlyArray<GitResult>>>;

/** Index of the config key in `git config --local --unset-all <key>`. */
const CONFIG_KEY_INDEX = 3;

/**
 * Commands identified by their leading argument alone. An author-configured
 * commit leads with `-c` (`git -c user.name=... Commit`), so `-c` maps to
 * `commit`.
 */
const COMMAND_BY_VERB: Readonly<Record<string, GitCommand>> = {
	"-c": "commit",
	"add": "add",
	"checkout": "checkout",
	"diff": "diff",
	"fetch": "fetch",
	"push": "push",
	"remote": "remoteSetUrl",
	"rev-parse": "revParse",
	"stash": "stashCreate",
	"status": "status",
};

/**
 * Build a successful {@link GitResult}.
 *
 * @param stdout - Captured standard output.
 * @returns The result.
 */
export function gitOk(stdout = ""): GitResult {
	return { code: 0, stderr: "", stdout };
}

const DEFAULT_RESPONSES: Readonly<Record<GitCommand, GitResult>> = {
	add: gitOk(),
	checkout: gitOk(),
	commit: gitOk(),
	configList: gitOk(),
	configUnsetExtraheader: gitOk(),
	configUnsetInclude: gitOk(),
	// `diff --cached --quiet` exits 1 when staged changes exist, 0 when clean;
	// the reflow only commits on a non-zero code.
	diff: { code: 1, stderr: "", stdout: "" },
	fetch: gitOk(),
	push: gitOk(),
	remoteSetUrl: gitOk(),
	revParse: gitOk("sha123\n"),
	stashCreate: gitOk("stash1"),
	status: gitOk(),
};

/**
 * Build a fake {@link GitExec} that records every argument vector it receives
 * and answers each command from the supplied response table, falling back to a
 * success for any command the table omits.
 *
 * @param responses - Canned results keyed by command.
 * @returns The recorded `calls` and the fake `git` runner.
 */
export function fakeGit(responses: GitResponses = {}): {
	calls: Array<ReadonlyArray<string>>;
	git: GitExec;
} {
	const calls: Array<ReadonlyArray<string>> = [];
	const cursors = new Map<GitCommand, number>();

	function respond(command: GitCommand): GitResult {
		const response = responses[command] ?? DEFAULT_RESPONSES[command];
		if ("code" in response) {
			return response;
		}

		const index = cursors.get(command) ?? 0;
		cursors.set(command, index + 1);
		return response[Math.min(index, response.length - 1)] ?? DEFAULT_RESPONSES[command];
	}

	async function gitAsync(args: ReadonlyArray<string>): Promise<GitResult> {
		calls.push(args);
		const command = classifyGitCall(args);
		// Resolve on a later microtask, as a real child-process round trip does.
		await Promise.resolve();
		return command === undefined ? gitOk() : respond(command);
	}

	return { calls, git: gitAsync };
}

/**
 * Build a failing {@link GitResult}.
 *
 * @param code - The non-zero exit code.
 * @param output - Captured standard error and standard output.
 * @returns The result.
 */
export function gitFail(
	code: number,
	output: { stderr?: string; stdout?: string } = {},
): GitResult {
	return { code, stderr: output.stderr ?? "", stdout: output.stdout ?? "" };
}

function classifyConfigCall(args: ReadonlyArray<string>): GitCommand | undefined {
	if (args.includes("--list")) {
		return "configList";
	}

	if (!args.includes("--unset-all")) {
		return undefined;
	}

	return args[CONFIG_KEY_INDEX]?.startsWith("includeif.") === true
		? "configUnsetInclude"
		: "configUnsetExtraheader";
}

/**
 * Label a raw `git` argument vector with the command it represents, or
 * `undefined` for a call the response table does not distinguish (which the
 * fake answers with a plain success).
 *
 * @param args - The argument vector passed to `git`.
 * @returns The matching command label, if any.
 */
function classifyGitCall(args: ReadonlyArray<string>): GitCommand | undefined {
	const [verb] = args;
	if (verb === undefined) {
		return undefined;
	}

	return verb === "config" ? classifyConfigCall(args) : COMMAND_BY_VERB[verb];
}
