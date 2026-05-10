// Parallel Planner with Design + Implement + Review: four-phase loop.
//
//   Phase 1 (Plan):      An opus agent analyses open issues, builds a
//                        dependency graph, and outputs a <plan> JSON listing
//                        unblocked issues with branch names.
//   Phase 2 (Design):    For each issue, an opus agent runs in the sandbox,
//                        explores siblings and ADRs, and writes a semi-high-
//                        level TDD plan to .sandcastle/plans/<id>.md
//                        (gitignored). One iteration, no code changes.
//   Phase 3 (Implement): A sonnet agent reads the plan and implements
//                        RED+GREEN slices on the branch (up to 100
//                        iterations). Does not push or open a PR.
//   Phase 4 (Review):    An opus agent runs /simplify, reviews the diff
//                        against the plan and project standards, fixes
//                        anything it finds, then pushes the branch, opens
//                        the PR with the sandcastle label, and watches CI
//                        (up to 5 iterations to leave room for CI fix-and-
//                        push cycles).
//
// All issue pipelines run concurrently via Promise.allSettled(), capped at
// MAX_PARALLEL. The outer loop repeats up to MAX_ITERATIONS times so newly
// unblocked issues are picked up after each round of PRs.
//
// Usage:
//   npx tsx .sandcastle/main.ts
// Or add to package.json:
//   "scripts": { "sandcastle": "npx tsx .sandcastle/main.ts" }

import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

import assert from "node:assert";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Maximum number of plan→execute cycles before stopping.
// Raise this if your backlog is large; lower it for a quick smoke-test run.
const MAX_ITERATIONS = 10;
const MAX_PARALLEL = 4;
const THINKING_MODEL = "claude-opus-4-7[1m]";
const AGENT_MODEL = "claude-sonnet-4-6";

// Smart thinking model for the planner, designer, and reviewer phases.
// effort "xhigh" is supported by Claude Opus 4.7's CLI but not yet typed
// in sandcastle 0.5.10's ClaudeCodeOptions.effort union; the cast bypasses
// the missing type without changing runtime behaviour.
// cspell:ignore xhigh
const thinkingAgent = sandcastle.claudeCode(THINKING_MODEL, { effort: "xhigh" as never });
const implementerAgent = sandcastle.claudeCode(AGENT_MODEL);

// Sandcastle starts the container with --user $hostUid:$hostGid (e.g.
// 501:20 on macOS); that UID has no entry in the image's /etc/passwd, so
// user lookups return empty. Tools that resolve user.home from the
// system passwd entry (pkl is the one we hit, transitively via `hk
// install --mise`) then fall back to a literal "?" path and create a
// `?/.pkl/cache` dir in cwd. Registering the running UID at hook time
// (idempotent: only writes the entry if it is missing) keeps that
// resolution honest. The Dockerfile relaxes /etc/passwd permissions so
// this write succeeds.
const REGISTER_HOST_UID =
	'grep -q ":x:$(id -u):" /etc/passwd || ' +
	'echo "host:x:$(id -u):$(id -g)::/home/agent:/bin/bash" >> /etc/passwd';

// Files copied from the host worktree into each sandbox worktree at spawn.
// We deliberately omit node_modules: the host has darwin-arm64 native
// addons, and a `pnpm install` inside a linux-arm64 container rewrites them
// to linux binaries, which would then break host tooling (eslint's
// oxc-parser, etc.) that reads the same paths via the bind-mount.
const copyToWorktree: Array<string> = [".env"];

// Shared pnpm content store on the host. Sandcastle bind-mounts this into
// every sandbox at /home/agent/.pnpm-store; combined with the
// `package-import-method=copy` baked into /home/agent/.npmrc, sandboxes
// share fetched packages and only hit the network for genuinely new ones.
const PNPM_STORE_HOST_DIR = join(homedir(), ".cache", "sandcastle-pnpm-store");
mkdirSync(PNPM_STORE_HOST_DIR, { recursive: true });

// Dedicated SSH signing key for sandbox commits. Bedrock requires signed
// commits on protected branches; the container has no GPG agent and we do
// not want to expose the host's authentication SSH key inside an LLM-driven
// sandbox. Generate this key once on the host and register the public part
// on GitHub as a Signing Key (Settings → SSH and GPG keys → New SSH key,
// Key type = Signing Key):
//
//   ssh-keygen -t ed25519 -f ~/.ssh/sandcastle_signing -N "" \
//     -C "sandcastle agent signing"
//
// The key is signing-only (does not authenticate pushes), so a leak only
// allows impersonating commit signatures, not repo writes.
const SIGNING_KEY_PATH = join(homedir(), ".ssh", "sandcastle_signing");
if (!existsSync(SIGNING_KEY_PATH)) {
	throw new Error(
		`Sandcastle SSH signing key not found at ${SIGNING_KEY_PATH}. ` +
			`Generate with: ssh-keygen -t ed25519 -f ${SIGNING_KEY_PATH} -N "" ` +
			'-C "sandcastle agent signing", then register the .pub on GitHub as a Signing Key.',
	);
}

// Read the host's git identity so sandbox commits attribute to the same
// author/committer the host would use, which lets GitHub match the
// signature against the key registered on the user's account.
const HOST_USER_NAME = execSync("git config --get user.name").toString().trim();
const HOST_USER_EMAIL = execSync("git config --get user.email").toString().trim();

// Host path of the main repo's .git directory. Bind-mounted into worktree
// sandboxes (Phases 2-4) so that libgit2-based tools (hk, git itself) can
// resolve the worktree's gitdir pointer; without this mount the pointer
// inside the container references a host filesystem path that does not
// exist, and any operation that opens the repo (hk check, git status,
// git commit) fails. --git-common-dir resolves to the main .git even when
// sandcastle is invoked from a subdirectory or from one of the host's own
// linked worktrees.
const HOST_GIT_DIR = execSync("git rev-parse --path-format=absolute --git-common-dir")
	.toString()
	.trim();

const sandboxMounts = [
	{ hostPath: PNPM_STORE_HOST_DIR, sandboxPath: "/home/agent/.pnpm-store" },
	{
		hostPath: SIGNING_KEY_PATH,
		readonly: true,
		sandboxPath: "/home/agent/.ssh/sandcastle_signing",
	},
	{
		hostPath: `${SIGNING_KEY_PATH}.pub`,
		readonly: true,
		sandboxPath: "/home/agent/.ssh/sandcastle_signing.pub",
	},
];

// Mounts shared by designer/implementer/reviewer sandboxes (Phases 2-4).
// The planner sandbox (Phase 1) runs from the host repo cwd directly, so
// its .git is a real directory inside the bind-mount and needs no extra
// mount.
const worktreeSandboxMounts = [
	...sandboxMounts,
	{ hostPath: HOST_GIT_DIR, sandboxPath: "/home/agent/.git-main" },
];

const sandboxEnvironment = {
	GIT_AUTHOR_EMAIL: HOST_USER_EMAIL,
	GIT_AUTHOR_NAME: HOST_USER_NAME,
	GIT_COMMITTER_EMAIL: HOST_USER_EMAIL,
	GIT_COMMITTER_NAME: HOST_USER_NAME,
	// mise treats untrusted config files as parse errors. The Dockerfile
	// bake-time `mise trust /home/agent/mise.toml` does not cover the
	// bind-mount path used by sandcastle 0.5.10 (/home/agent/workspace).
	// Trust the parent directory so any nested mise.toml is accepted.
	MISE_TRUSTED_CONFIG_PATHS: "/home/agent",
};

// Configure ssh-signing inside the sandbox. Run as a hook step (rather than
// being baked into the image) so the signing key path resolves to the
// bind-mounted key and the identity follows whoever runs sandcastle.
// cspell:ignore signingkey gpgsign
const CONFIGURE_GIT_SIGNING = [
	'git config --global user.name "$GIT_AUTHOR_NAME"',
	'git config --global user.email "$GIT_AUTHOR_EMAIL"',
	"git config --global gpg.format ssh",
	"git config --global user.signingkey /home/agent/.ssh/sandcastle_signing.pub",
	"git config --global commit.gpgsign true",
	"git config --global tag.gpgsign true",
].join(" && ");

// cspell:ignore gitdir libgit
// Repair the worktree's gitdir pointer so the in-container paths line up
// with the new bind-mount of <main>/.git at /home/agent/.git-main.
//
// Each step:
//   - cd /: git config and safe.directory inspect the current repo, which
//     would otherwise follow the still-broken pointer in /home/agent/workspace
//     and abort the hook before we get a chance to fix it.
//   - safe.directory entries: container UID (host UID, e.g. 501 on macOS)
//     does not match the file ownership inside the bind-mounts, so libgit2
//     refuses to open them without an explicit allow-list.
//   - gc.auto 0: prevents a sandbox-side gc/repack from racing the host's
//     concurrent git operations on the shared <main>/.git/objects.
//   - rewrite the worktree's .git pointer to the in-container .git-main path.
//     Sed extracts the worktree name from the existing (broken) pointer so
//     this works for any host path layout, not just sandcastle's. Without
//     this step `git worktree repair` itself fails because it tries to read
//     the broken pointer first.
//   - git worktree repair: official tool that writes the matching gitdir
//     file on the main side; idempotent if paths already match.
//   - extensions.worktreeConfig + core.hooksPath isolation: <main>/.git/hooks
//     is shared across every worktree, including the host's. Without this,
//     `hk install --mise` (next hook step) would overwrite the host's hooks
//     with sandbox-flavoured ones, and a misbehaving sandbox could install
//     a hook that fires on the next host commit. Setting core.hooksPath at
//     --worktree scope keeps each sandbox's hooks in /home/agent/.git-hooks,
//     leaving the host's .git/hooks untouched.
const REPAIR_WORKTREE_GIT = [
	"cd /",
	"git config --global --add safe.directory /home/agent/workspace",
	"git config --global --add safe.directory /home/agent/.git-main",
	"git config --global gc.auto 0",
	'name=$(basename "$(sed -n "s/^gitdir: //p" /home/agent/workspace/.git)")',
	'{ [ -n "$name" ] && [ "$name" != "." ]; } || { echo "REPAIR_WORKTREE_GIT: cannot parse worktree name from /home/agent/workspace/.git" >&2; exit 1; }',
	'echo "gitdir: /home/agent/.git-main/worktrees/$name" > /home/agent/workspace/.git',
	"git -C /home/agent/workspace worktree repair",
	// Set extensions.worktreeConfig only when missing so we leave the host
	// repo's .git/config untouched on subsequent sandbox spawns.
	"git config --file /home/agent/.git-main/config --get extensions.worktreeConfig 2>/dev/null | grep -qx true || git config --file /home/agent/.git-main/config extensions.worktreeConfig true",
	"mkdir -p /home/agent/.git-hooks",
	"git -C /home/agent/workspace config --worktree core.hooksPath /home/agent/.git-hooks",
].join(" && ");

// Hooks for designer/implementer/reviewer sandboxes (Phases 2-4). These run
// inside an isolated git worktree, so `pnpm install` writing linux-arm64
// native addons is contained.
//
// MISE_TRUSTED_CONFIG_PATHS in sandboxEnvironment covers the trust
// requirement; `hk install --mise` wires the project's git hooks into the
// worktree's .git/. `CI=true` keeps pnpm non-interactive (no TTY in sandbox
// exec). 5-min timeout covers an 8-workspace cold install plus build scripts.
const implementerHooks = {
	sandbox: {
		onSandboxReady: [
			{ command: REGISTER_HOST_UID },
			{ command: REPAIR_WORKTREE_GIT },
			{ command: CONFIGURE_GIT_SIGNING },
			{ command: "hk install --mise" },
			{ command: "CI=true pnpm install", timeoutMs: 300_000 },
		],
	},
};

// Hooks for the planner (Phase 1). The planner only reads issues via `gh`
// and never compiles or tests code, so it skips `pnpm install` and skips
// the signing setup since it never produces commits. Critical: the planner
// runs against the bind-mounted host repo (not an isolated worktree), so
// any in-sandbox `pnpm install` would rewrite host node_modules with
// linux-arm64 native bindings and break host tooling (eslint's
// oxc-parser, vitest, etc.).
const plannerHooks = {
	sandbox: {
		onSandboxReady: [{ command: REGISTER_HOST_UID }, { command: "hk install --mise" }],
	},
};

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
	console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===\n`);

	// -------------------------------------------------------------------------
	// Phase 1: Plan
	//
	// The planning agent (opus, for deeper reasoning) reads the open issue list,
	// builds a dependency graph, and selects the issues that can be worked in
	// parallel right now (i.e., no blocking dependencies on other open issues).
	//
	// It outputs a <plan> JSON block that we parse to drive Phase 2.
	// -------------------------------------------------------------------------
	const plan = await sandcastle.run({
		name: "planner",
		agent: thinkingAgent,
		hooks: plannerHooks,
		promptFile: "./.sandcastle/plan-prompt.md",
		sandbox: docker({ env: sandboxEnvironment, mounts: sandboxMounts }),
	});

	// Extract the <plan>…</plan> block from the agent's stdout.
	const planMatch = plan.stdout.match(/<plan>([\s\S]*?)<\/plan>/);
	if (!planMatch) {
		throw new Error(`Planning agent did not produce a <plan> tag.\n\n${plan.stdout}`);
	}

	const [, planJson] = planMatch;
	assert(planJson !== undefined, "Plan JSON is empty");

	// The plan JSON contains an array of issues, each with id, title, branch.
	const { issues } = JSON.parse(planJson) as {
		issues: Array<{ branch: string; id: string; title: string }>;
	};

	if (issues.length === 0) {
		// No unblocked work: either everything is done or everything is blocked.
		console.log("No unblocked issues to work on. Exiting.");
		break;
	}

	console.log(`Planning complete. ${issues.length} issue(s) to work in parallel:`);
	for (const issue of issues) {
		console.log(`  ${issue.id}: ${issue.title} → ${issue.branch}`);
	}

	// -------------------------------------------------------------------------
	// Phases 2-4: Design + Implement + Review
	//
	// For each issue, create one sandbox via createSandbox() so the designer,
	// implementer, and reviewer share the same sandbox instance per branch.
	// The designer writes a plan to PLAN_PATH (gitignored). The implementer
	// reads the plan and codes; if it produces commits, the reviewer runs in
	// the same sandbox to simplify, review, push, and open the PR.
	//
	// Promise.allSettled means one failing pipeline doesn't cancel the others.
	// -------------------------------------------------------------------------
	let running = 0;
	const queue: Array<() => void> = [];
	// eslint-disable-next-line unicorn/consistent-function-scoping -- Using loop state
	async function acquire(): Promise<void> {
		if (running < MAX_PARALLEL) {
			running++;
			return;
		}

		return new Promise((resolve) => {
			queue.push(resolve);
		});
	}

	// eslint-disable-next-line unicorn/consistent-function-scoping -- Using loop state
	function release(): void {
		running--;
		const next = queue.shift();
		if (next) {
			running++;
			next();
		}
	}

	const settled = await Promise.allSettled(
		// eslint-disable-next-line max-lines-per-function -- From upstream template
		issues.map(async (issue) => {
			await acquire();

			try {
				await using sandbox = await sandcastle.createSandbox({
					branch: issue.branch,
					copyToWorktree,
					hooks: implementerHooks,
					sandbox: docker({ env: sandboxEnvironment, mounts: worktreeSandboxMounts }),
				});

				const planPath = `.sandcastle/plans/${issue.id}.md`;
				const sharedPromptArgs = {
					BRANCH: issue.branch,
					ISSUE_TITLE: issue.title,
					PLAN_PATH: planPath,
					TASK_ID: issue.id,
				};

				// Designer phase: opus, one iteration. Writes the plan to
				// PLAN_PATH (gitignored). No code, no commits.
				await sandbox.run({
					name: `designer #${issue.id}`,
					agent: thinkingAgent,
					maxIterations: 1,
					promptArgs: sharedPromptArgs,
					promptFile: "./.sandcastle/design-prompt.md",
				});

				// Implementer phase: sonnet reads the plan and implements
				// RED+GREEN slices on the branch.
				const result = await sandbox.run({
					name: `implementer #${issue.id}`,
					agent: implementerAgent,
					maxIterations: 100,
					promptArgs: sharedPromptArgs,
					promptFile: "./.sandcastle/implement-prompt.md",
				});

				// Reviewer phase: opus runs /simplify, reviews against the
				// plan, fixes issues, then pushes, opens the PR, and watches
				// CI. Skipped when the implementer made no commits.
				if (result.commits.length > 0) {
					await sandbox.run({
						name: `reviewer #${issue.id}`,
						agent: thinkingAgent,
						// Reviewer also waits on CI and may need to push fixes
						// across multiple turns if checks fail.
						maxIterations: 5,
						promptArgs: sharedPromptArgs,
						promptFile: "./.sandcastle/review-prompt.md",
					});
				}

				return result;
			} finally {
				release();
			}
		}),
	);

	// Log any agents that threw (network error, sandbox crash, etc.).
	for (const [index, outcome] of settled.entries()) {
		if (outcome.status === "rejected") {
			console.error(
				// eslint-disable-next-line ts/no-non-null-assertion -- Guaranteed
				`  ✗ ${issues[index]!.id} (${issues[index]!.branch}) failed: ${outcome.reason}`,
			);
		}
	}

	// Log completed branches. Reviewers are responsible for pushing and
	// opening PRs; nothing is merged locally.
	const completedBranches = settled
		// eslint-disable-next-line ts/no-non-null-assertion -- Guaranteed
		.map((outcome, index) => ({ issue: issues[index]!, outcome }))
		.filter((entry) => {
			return entry.outcome.status === "fulfilled" && entry.outcome.value.commits.length > 0;
		})
		.map((entry) => entry.issue.branch);

	console.log(`\nExecution complete. ${completedBranches.length} branch(es) with commits:`);
	for (const branch of completedBranches) {
		console.log(`  ${branch}`);
	}
}

console.log("\nAll done.");
