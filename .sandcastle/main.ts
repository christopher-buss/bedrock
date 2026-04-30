// Parallel Planner with Review: two-phase orchestration loop
//
// This template drives a multi-phase workflow:
//   Phase 1 (Plan):             An opus agent analyzes open issues, builds a
//                               dependency graph, and outputs a <plan> JSON
//                               listing unblocked issues with branch names.
//   Phase 2 (Execute + Review): For each issue, a sandbox is created via
//                               createSandbox(). The implementer runs first
//                               (up to 100 iterations). If it produces
//                               commits, a reviewer runs in the same sandbox
//                               on the same branch (up to 5 iterations, to
//                               leave room for CI fix-and-push cycles). All
//                               issue pipelines run concurrently via
//                               Promise.allSettled(). Implementers push their
//                               branches and open PRs directly; there is no
//                               local merge phase.
//
// The outer loop repeats up to MAX_ITERATIONS times so that newly unblocked
// issues are picked up after each round of PRs.
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
const AGENT_MODEL = "claude-opus-4-7[1m]";

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
const copyToWorktree: Array<string> = [];

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

const sandboxEnvironment = {
	GIT_AUTHOR_EMAIL: HOST_USER_EMAIL,
	GIT_AUTHOR_NAME: HOST_USER_NAME,
	GIT_COMMITTER_EMAIL: HOST_USER_EMAIL,
	GIT_COMMITTER_NAME: HOST_USER_NAME,
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

// Hooks for implementer/reviewer sandboxes (Phase 2). These run inside an
// isolated git worktree, so `pnpm install` writing linux-arm64 native addons
// is contained.
//
// `hk install --mise` wires the project's git hooks into the worktree's
// .git/. `CI=true` keeps pnpm non-interactive (no TTY in sandbox exec).
// 5-min timeout covers an 8-workspace cold install plus build scripts.
const implementerHooks = {
	sandbox: {
		onSandboxReady: [
			{ command: REGISTER_HOST_UID },
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
		// Opus for planning: dependency analysis benefits from deeper reasoning.
		agent: sandcastle.claudeCode(AGENT_MODEL),
		hooks: plannerHooks,
		// One iteration is enough: the planner just needs to read and reason,
		// not write code.
		maxIterations: 1,
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
	// Phase 2: Execute + Review
	//
	// For each issue, create a sandbox via createSandbox() so the implementer
	// and reviewer share the same sandbox instance per branch. The implementer
	// runs first; if it produces commits, the reviewer runs in the same sandbox.
	//
	// Promise.allSettled means one failing pipeline doesn't cancel the others.
	// -------------------------------------------------------------------------

	const settled = await Promise.allSettled(
		// eslint-disable-next-line max-lines-per-function -- From upstream template
		issues.map(async (issue) => {
			const sandbox = await sandcastle.createSandbox({
				branch: issue.branch,
				copyToWorktree,
				hooks: implementerHooks,
				sandbox: docker({ env: sandboxEnvironment, mounts: sandboxMounts }),
			});

			try {
				// Run the implementer
				const implement = await sandbox.run({
					name: "implementer",
					agent: sandcastle.claudeCode(AGENT_MODEL),
					maxIterations: 100,
					promptArgs: {
						BRANCH: issue.branch,
						ISSUE_TITLE: issue.title,
						TASK_ID: issue.id,
					},
					promptFile: "./.sandcastle/implement-prompt.md",
				});

				// Only review if the implementer produced commits
				if (implement.commits.length > 0) {
					const review = await sandbox.run({
						name: "reviewer",
						agent: sandcastle.claudeCode(AGENT_MODEL),
						// Reviewer also waits on CI and may need to push fixes
						// across multiple turns if checks fail.
						maxIterations: 5,
						promptArgs: {
							BRANCH: issue.branch,
						},
						promptFile: "./.sandcastle/review-prompt.md",
					});

					// Combine commits from both runs so the post-execution
					// completed-branches log reflects all work on the branch.
					// Each sandbox.run() only returns commits from its own run.
					return {
						...review,
						commits: [...implement.commits, ...review.commits],
					};
				}

				return implement;
			} finally {
				await sandbox.close();
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

	// Log completed branches. Implementers are responsible for pushing and
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
