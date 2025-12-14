---
# prettier-ignore
description: Create implementation plan from feature/requirement with PRD-style discovery and TDD acceptance criteria
argument-hint: <feature/requirement description or GitHub issue URL/number>
---

# Plan: PRD-Informed Task Planning for TDD

Create structured implementation plan that bridges product thinking (PRD) with
test-driven development.

## Input

$ARGUMENTS

(If no input provided, check conversation context)

## Input Processing

The input can be one of:

1. **GitHub Issue URL** (e.g., `https://github.com/owner/repo/issues/123`)
2. **GitHub Issue Number** (e.g., `#123` or `123`)
3. **Feature Description** (e.g., "Add user authentication")
4. **Empty** - use conversation context

### GitHub Issue Integration

If input looks like a GitHub issue:

**Step 1: Extract Issue Number**

- From URL: extract owner/repo/number
- From number: try to infer repo from git remote
- From branch name: check patterns like `issue-123`, `123-feature`,
  `feature/123`

**Step 2: Fetch Issue**

Use `gh` CLI to fetch issue details: `gh issue view <number>`

**Step 3: Use Issue as Discovery Input**

- Title → Feature name
- Description → Problem statement and context
- Labels → Type/priority hints
- Comments → Additional requirements and discussion
- Linked issues → Dependencies

Extract from GitHub issue:

- Problem statement and context
- Acceptance criteria (if present)
- Technical notes (if present)
- Related issues/dependencies

## Process

## Discovery Phase

Understand the requirement by asking (use AskUserQuestion if needed):

**Problem Statement**

- What problem does this solve?
- Who experiences this problem?
- What's the current pain point?

**Desired Outcome**

- What should happen after this is built?
- How will users interact with it?
- What does success look like?

**Scope & Constraints**

- What's in scope vs. out of scope?
- Any technical constraints?
- Dependencies on other systems/features?

**Context Check**

- Search codebase for related features/modules
- Check for existing test files that might be relevant

## Key Principles

**From PRD World:**

- Start with user problems, not solutions
- Define success criteria upfront
- Understand constraints and scope

**From TDD World:**

- Make acceptance criteria test-ready
- Break work into small, testable pieces
- Each task should map to test(s)

## Integration with Other Commands

- **Before /plan**: Use `/spike` if you need technical exploration first
- **After /plan**: Use `/red` to start TDD on first task
