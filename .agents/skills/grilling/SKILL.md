---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. A round is the **top three** frontier questions, ranked by how many downstream decisions each unblocks; the rest of the frontier waits for a later round. Ask the round, then wait for the user's answers.

The user skims. A round is **skimmable**: recommendation before question, one line per part, plain numbered text.

Write every round, expansion, and summary in ASD-STE100 Simplified Technical English, and name things with the ubiquitous language from `CONTEXT.md` (follow `CONTEXT-MAP.md` to the right one if the repo has more than one).

Format a round like so:

Round <n>. <settled> settled. <open> open. <waiting> waiting.
Reply with only the numbers you disagree with. Silence accepts the recommendation.

1. <title, one line>
   -> Recommend: <one line>
   Question: <one or two sentences>

2. ...

Header counts: settled = decisions answered so far; open = questions in this round; waiting = frontier questions held back.

Each round the user answers reshapes the tree: a number the user leaves unmentioned settles on the recommendation; settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one. When the user says "expand N", give the full reasoning for that one question, then wait.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
