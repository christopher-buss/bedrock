# ADR-006: ADR Enforcement

Date: 2025-12-13 Status: Accepted

Decision Makers: Maintainer Tags: governance, process, documentation,
ai-assisted

## Context

Bedrock is AI-assisted infrastructure tooling. CLAUDE.md currently has soft
guidance for creating ADRs: "For significant architectural choices, create an
ADR using the template" (line 129-132). This is insufficient because:

**Problems with current approach:**

- "Significant architectural choices" is vague and subjective
- Language is suggestive ("create an ADR"), not mandatory
- No enforcement mechanism for Claude Code
- No clear criteria for when ADRs are required
- Claude could make architectural decisions without documentation
- ADRs risk becoming template-filling exercises rather than thoughtful analysis

**Why this matters for AI-assisted development:**

AI agents can implement changes quickly without documenting rationale. In
traditional development, decision context lives in team discussions, code
reviews, and institutional knowledge. With AI assistance, that context
evaporates unless explicitly captured.

Requirements:

- Clear triggers for when ADRs are mandatory
- Enforcement through CLAUDE.md (AI-readable project context)
- Methodological process to prevent template-filling
- Balance rigor with pragmatism (not every decision needs an ADR)

## Decision

**Make ADRs mandatory for architectural decisions with explicit triggers and
methodological process.**

### Part 1: Define Mandatory Triggers

ADRs are **MANDATORY** before implementation when ANY of these apply:

1. **Technology Choices**: New dependencies, build tools, frameworks, patterns
2. **Architectural Patterns**: New layers, boundaries, abstractions,
   communication
3. **External Integrations**: Third-party services, APIs, auth, state storage
4. **Data Models**: State persistence, serialization, config formats, migrations
5. **Security & Constraints**: Auth methods, security requirements, secret mgmt
6. **Developer Workflow**: CI/CD, testing requirements, code generation
7. **Breaking Changes**: Backwards-incompatible changes, deprecations, removals

**Explicitly NOT required:**

- Bug fixes that don't change architecture
- Tests for existing code
- Behavior-preserving refactors
- Documentation updates (unless changing doc strategy)
- Performance optimizations without new dependencies
- Features following existing patterns

**Rule of thumb:** If asking "should this be an ADR?" - it probably should be.

### Part 2: Methodological Q&A Process

ADR creation must be **slow and methodological**. No assumptions. Guide through:

1. **Context Gathering**: Problem? Constraints? Current state? Who's affected?
2. **Options Exploration**: Alternatives? Pros/cons each? What if do nothing?
3. **Decision Criteria**: What matters most? Deal-breakers? Timeline? Risk?
4. **Consequences Analysis**: Positive outcomes? Trade-offs? Reversible? Future?
5. **Documentation Review**: Review draft, confirm accuracy, identify gaps

**Rules:**

- One question at a time for complex decisions
- Never assume - always confirm
- Use AskUserQuestion tool liberally
- Reference existing ADRs for consistency
- Draft incrementally through conversation, not all at once

### Part 3: Enforcement

**In CLAUDE.md** (mandatory project context for Claude Code):

- Replace soft "Making Decisions" section with "Making Architectural Decisions
  (MANDATORY)"
- Include 7 trigger categories with examples
- Include methodological Q&A process
- Explicit instructions for Claude Code to STOP and create ADR first

**In `.claude/agents/adr.md`** (custom ADR agent):

- Add "Methodological Q&A Process (MANDATORY)" section
- Update "Decision-Making Framework" to reference structured process
- Emphasize slow, deliberate approach over template-filling

## Consequences

### Positive

- Clear criteria eliminate "is this significant enough?" ambiguity
- Methodological process ensures thoughtful analysis, not template-filling
- AI agents can't skip documentation step for architectural changes
- Decision rationale captured for future maintainers
- Consistent with existing rigor (TDD, 100% coverage requirements)
- Prevents "move fast and break architecture" anti-pattern

### Negative

- Higher documentation overhead for architectural work
- Slows down implementation (deliberate - forcing thoughtfulness)
- Requires user engagement for Q&A process
- May feel heavy-handed for "obvious" decisions
- ADR agent needs updates to enforce new process

### Neutral

- This ADR is meta: documenting how to document
- Following own rule: creating ADR-006 before implementing enforcement
- Balance needed: rigor without bureaucracy

## Alternatives Considered

### Keep soft guidance

**Rejected**: Already tried. Claude makes architectural changes without ADRs
because guidance is vague. AI needs explicit, unambiguous rules.

### Require ADRs for everything

**Rejected**: Bureaucratic overhead. Bug fixes and minor changes don't need
ADRs. Clear exclusions prevent abuse.

### Post-hoc ADRs (document after implementation)

**Rejected**: Defeats purpose. ADRs should inform decisions, not rationalize
them after the fact. Retroactive ADRs OK for _past_ decisions, but not for
_current_ work.

### Lightweight decision log instead of full ADRs

**Rejected**: Evaluated informal decision log format. ADR structure forces
consideration of alternatives and consequences. Lightweight format enables
template-filling. Structure is the point.

### Automated ADR generation from code changes

**Rejected**: Can't infer decision context from code diffs. Alternatives
considered, trade-offs accepted, and problem context require human input.
Automation would produce garbage documentation.

## Implementation Notes

**Files to modify:**

1. `CLAUDE.md` (lines 129-132): Replace "Making Decisions" section
2. `.claude/agents/adr.md`: Add methodological Q&A process section
3. `docs/adr/README.md`: Add ADR-006 to index

**Tone to match:** "Testing Requirements (NON-NEGOTIABLE)" section (CLAUDE.md
line 51). Explicit, mandatory language like ADR-003.

**Verification:**

- Test: Ask Claude to add new dependency → should refuse without ADR
- Test: Ask Claude to fix bug → should proceed without ADR

## Related Decisions

- ADR-003: Testing Strategy (same mandatory enforcement approach)

## References

- [CLAUDE.md current "Making Decisions" section](../../CLAUDE.md)
- [ADR template](../templates/adr.md)
- [.claude/agents/adr.md custom agent](../../.claude/agents/adr.md)
