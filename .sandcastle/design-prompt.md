# TASK

Design a TDD implementation plan for issue {{TASK_ID}}: {{ISSUE_TITLE}}.

Pull in the issue using `gh issue view {{TASK_ID}}`. If it has a parent PRD, pull that in too.

You are the designer. You will not write code. Your job is to write a plan that a separate implementer agent will execute on branch `{{BRANCH}}`.

The implementer is a smaller model that benefits from explicit direction. Aim for semi-high-level guidance: pseudo-code and shape sketches are good; exact code is not necessary. Cover everything the implementer needs to do this task well. The reviewer will close any remaining gaps after implementation.

## CONTEXT

Here are the last 10 commits:

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

## EXPLORATION

Explore the repo deeply enough to anchor the plan in existing practices:

- Find the closest sibling code (a similar feature, an analogous resource, a parallel client). The plan should follow the same shape.
- Read relevant ADRs in `docs/adr/` and any `CONTEXT.md` for the package being touched.
- Understand the test conventions and existing TDD slices in nearby work.
- Note conventions specific to this domain (FCIS layering, naming, types, jest-extended matchers, etc.).

## PLAN STRUCTURE

Write the plan to `{{PLAN_PATH}}`. Structure it as:

1. **Scope**: one short paragraph stating what this task does and does not change.
2. **Sibling reference**: name the existing code the implementer should mirror, with paths.
3. **Slice breakdown**: list each behaviour slice (one test per slice). For each slice include the test name (`it("should ...")`), a one-sentence behaviour description, the key files to touch, and pseudo-code or a shape sketch where it helps the implementer.
4. **Non-goals**: anything the implementer might be tempted to add but shouldn't (e.g. methods deferred per the issue).
5. **Open questions**: anything you couldn't resolve from the issue plus codebase. The reviewer will resolve these during review.

Follow `CLAUDE.md` conventions throughout: TDD slices, kebab-case commit subjects, no em-dashes, no `as` casts, `T | undefined` not `T | null`, jest-extended matchers wired via `@bedrock/testing/jest-extended`.

## OUTPUT

Once the plan is written and saved to `{{PLAN_PATH}}`, output <promise>COMPLETE</promise>.

Do not write code. Do not commit anything.
