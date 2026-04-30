// Parallel Planner with Review — three-phase orchestration loop
//
// This template drives a multi-phase workflow:
//   Phase 1 (Plan):             An opus agent analyzes open issues, builds a
//                               dependency graph, and outputs a <plan> JSON
//                               listing unblocked issues with branch names.
//   Phase 2 (Execute + Review): For each issue, a sandbox is created via
//                               createSandbox(). The implementer runs first
//                               (100 iterations). If it produces commits, a
//                               reviewer runs in the same sandbox on the same
//                               branch (1 iteration). All issue pipelines run
//                               concurrently via Promise.allSettled().
//                               Implementers push their branches and open PRs
//                               directly; there is no local merge phase.
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

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Maximum number of plan→execute cycles before stopping.
// Raise this if your backlog is large; lower it for a quick smoke-test run.
const MAX_ITERATIONS = 10;
const AGENT_MODEL = "claude-opus-4-7[1m]";

// Hooks run inside the sandbox before the agent starts each iteration.
// pnpm install ensures the sandbox always has fresh dependencies.
const hooks = {
	sandbox: { onSandboxReady: [{ command: "pnpm install" }] },
};

// Copy node_modules from the host into the worktree before each sandbox
// starts. Avoids a full npm install from scratch; the hook above handles
// platform-specific binaries and any packages added since the last copy.
const copyToWorktree = ["node_modules"];

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
	// It outputs a <plan> JSON block — we parse that to drive Phase 2.
	// -------------------------------------------------------------------------
	const plan = await sandcastle.run({
		name: "planner",
		// Opus for planning: dependency analysis benefits from deeper reasoning.
		agent: sandcastle.claudeCode(AGENT_MODEL),
		hooks,
		// One iteration is enough: the planner just needs to read and reason,
		// not write code.
		maxIterations: 1,
		promptFile: "./.sandcastle/plan-prompt.md",
		sandbox: docker(),
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
		// No unblocked work — either everything is done or everything is blocked.
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
				hooks,
				sandbox: docker(),
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
