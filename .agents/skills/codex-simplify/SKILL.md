---
name: codex-simplify
description: Review changed code for reuse, quality, and efficiency, then fix issues found. Use when the user asks to simplify, clean up, polish, or review recent code changes.
---

# Simplify: Code Review and Cleanup

Review the requested scope for reuse, quality, and efficiency. Fix actionable issues using the rules in `CLAUDE.md`.

## Phase 1: Identify Changes

For an implementation cleanup, use the ticket or feature diff, including its committed changes. For a follow-up, use the delta since the reviewed revision plus unresolved findings. Include staged and unstaged changes when present. Record the scope and revision so a clean working tree or compaction does not reopen completed work.

The three-agent pass below is the initial cleanup of that scope. After fixes, check the findings and subsequent changes directly; repeat the full pass only for substantial new scope or risk, or an explicit user request.

## Phase 2: Launch Three Review Agents in Parallel

Use the Agent tool (for Codex: spawn_agent; for OpenCode: Task) to launch all three agents concurrently in a single message. Pass each agent the full diff so it has the complete context.

### Agent 1: Code Reuse Review

For each change:

1. **Search for existing utilities and helpers** that could replace newly written code. Look for similar patterns elsewhere in the codebase: `packages/*/src/core/`, `packages/*/src/ports/`, `packages/open-cloud/src/internal/`, `packages/testing/src/`, and files adjacent to the changed ones.
2. **Flag any new function that duplicates existing functionality.** Suggest the existing function to use instead.
3. **Flag any inline logic that could use an existing utility**: environment access outside `packages/bedrock/src/core/get-environment.ts` and `packages/bedrock/src/cli/`, hand-rolled Open Cloud requests that bypass `packages/open-cloud/src/internal/resource-client.ts`, ad-hoc type guards, and similar patterns.

### Agent 2: Code Quality Review

Review the same changes for hacky patterns:

1. **Redundant state**: state that duplicates existing state, cached values that could be derived, observers that could be direct calls
2. **Parameter sprawl**: adding new parameters to a function instead of generalizing or restructuring existing ones
3. **Copy-paste with slight variation**: near-duplicate code blocks that should be unified with a shared abstraction
4. **Leaky abstractions**: exposing internal details that should be encapsulated, or breaking existing abstraction boundaries; I/O inside `core/`, adapters reached without a port, or process access (`process.exit`, `process.argv`, `process.env`) outside `packages/bedrock/src/cli/`
5. **Stringly-typed code**: using raw strings where constants, string unions, or branded types already exist in the codebase; errors that bypass the classes in `packages/open-cloud/src/errors/`
6. **Type escapes**: `as` casts, `null` where the codebase uses `undefined`, and `: unknown` annotations on values that are already typed (`CLAUDE.md`, "Type Conventions")
7. **Unnecessary comments**: comments explaining WHAT the code does, narrating the change, defending the choice, or referencing the task, caller, or an ADR: delete. A comment states an invariant in a line or two; the argument for an edit goes in the commit

### Agent 3: Efficiency Review

Review the same changes for efficiency:

1. **Unnecessary work**: redundant computations, repeated file reads, duplicate Open Cloud requests or state reads
2. **Missed concurrency**: independent operations run sequentially when they could run in parallel within the client's rate limits
3. **Hot-path bloat**: new blocking work added to CLI startup or to the plan and apply loops
4. **Recurring no-op updates**: state writes or progress events that fire unconditionally. Add a change-detection guard so downstream consumers aren't notified when nothing changed
5. **Unnecessary existence checks**: pre-checking file/resource existence before operating (TOCTOU anti-pattern). Operate directly and handle the error
6. **Resource leaks**: unbounded data structures, missing cleanup, event listener leaks, child processes or pipes left open
7. **Overly broad operations**: reading entire files when only a portion is needed, listing every resource when filtering for one

## Phase 3: Fix Issues

Wait for all three agents to complete. Aggregate their findings and fix each issue directly. If a finding is a false positive or not worth addressing, note it and move on; do not argue with the finding, just skip it.

When done, briefly summarize what was fixed (or confirm the code was already clean).
