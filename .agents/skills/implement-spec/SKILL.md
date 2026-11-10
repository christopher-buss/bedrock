---
name: implement-spec
description: "Implement the result of /to-spec and /to-tickets as one stack of PRs."
disable-model-invocation: true
---

You have been provided a spec. This spec should have tickets associated with it, describing how to implement the spec.

The issue tracker should have been provided to you. If not, tell the user to run `/setup-matt-pocock-skills`.

The goal is the entire spec implemented as a single **stack**: one **layer** (branch and PR) per ticket, every PR passing the repo's PR checks on its own, and every ticket resolved the way the issue tracker closes work.

The tickets are not a list of steps. They are a **task graph** with blocking relationships between them. This means there is always a **frontier** of tickets which are ready to be grabbed.

Parallel work happens off the stack, in implementer worktrees. The stack itself stays strictly linear: tickets join it one at a time, in the order they land, at the **stack top**. A ticket only enters the frontier once its blockers have landed, so landing order is always a valid dependency order. Before the first ticket lands, the stack top is trunk.

Communication to and from subagents should be sparse. Communicate primarily through **context pointers**: to the spec, tickets, research notes, and previous commits. Don't duplicate information already available via pointers.

**Implementer subagents** should be run in the background where possible for maximum concurrency.

## Steps

1. Read the spec and tickets to understand the task graph.

2. (optional) Use an **exploration subagent** to conduct any exploration required by the tickets - relevant codebase files or external documentation. Ensure the exploration subagent can save files - it should save its markdown notes in a directory outside the repo, accessible by all future subagents. This lets **implementer subagents** focus on implementation rather than exploration.

3. Call the Skill tool with `gh-stack` and run its setup. Pick a topic prefix for the spec. Each layer is named `<topic>/<ticket-slug>`.

4. Use **implementer subagents** to implement each ticket, each in its own worktree on its own work branch. Each implementer subagent:
   - confirms its worktree is based on the stack top before starting, and resets onto it if not;
   - calls the Skill tool with `tdd` to build the ticket;
   - rebases its work branch onto the current stack top before reporting done.

5. Once an **implementer subagent** completes, land its work with a **stacker subagent**. Run one stacker at a time: stack writes serialize across the clone. The stacker:
   - calls the Skill tool with `gh-stack`;
   - checks out the stack top, then adds the ticket's layer (`gh stack init <layer>` for the first ticket, `gh stack add <layer>` after);
   - cherry-picks the work branch's commits onto the layer, and calls the Skill tool with `resolving-merge-conflicts` on any conflict;
   - confirms the tests pass on the new layer.

6. If this changes the **frontier** of available tickets, kick off more **implementer subagents** to work on the new tickets. This allows for maximum concurrency.

7. Once all tickets have landed, call the Skill tool with `code-review` on trunk..stack top. Fix all issues raised by the code review in a single **implementer subagent**, which calls the Skill tool with `gh-stack` and works on the stack directly: each fix is committed on the layer that owns the code, then rebased upstack.

8. Submit the stack with `gh stack submit --auto`. Rewrite each PR's title and body with `gh pr edit` to follow the repo's PR conventions: each PR closes its ticket, and the top PR also closes the spec. If the issue tracker does not close work through PRs and the user has not asked for them, skip the submit: resolve each ticket the way the issue tracker closes work, and report the stack with `gh stack view --json`.

9. Clean up all **implementer subagent** worktrees and work branches.
