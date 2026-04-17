# Bedrock Project Context

## What is Bedrock?

Infrastructure-as-Code deployment tool for Roblox, written in TypeScript. Modern
replacement for [Mantle](https://github.com/blake-mealey/mantle) (Rust-based
tool no longer maintained).

## Architecture

- **Language**: TypeScript (ES modules)
- **Runtime**: Bun
- **Config**: c12-based multi-format support (TS, JS, YAML, JSON)
- **State**: GitHub Gists (default), extensible backends
- **Auth**: Roblox Open Cloud APIs only (no ROBLOSECURITY)
- **Toolchain**: Vite+ (`vp pack` builds, `vp test` runs Vitest, `vp run` orchestrates tasks)
- **Lint**: eslint from monorepo root only (`pnpm lint`), no per-package lint scripts

## Architecture Quick Reference

**Pattern**: FCIS (Functional Core, Imperative Shell) + Ports

```text
┌─────────────────────────────────────────────────────┐
│                      Shell                          │
│  (I/O, CLI commands, orchestration)                 │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │                   Core                       │   │
│  │  (Pure functions, business logic, no I/O)   │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │  Port    │  │  Port    │  │  Port    │         │
│  │ (State)  │  │(OpenCloud)│ │ (Config) │         │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘         │
└───────┼─────────────┼─────────────┼───────────────┘
        │             │             │
   ┌────▼────┐  ┌─────▼────┐  ┌────▼─────┐
   │ Adapter │  │ Adapter  │  │ Adapter  │
   │ (Gist)  │  │ (HTTP)   │  │  (c12)   │
   └─────────┘  └──────────┘  └──────────┘
```

- **Core**: Pure functions, no side effects, easy to test
- **Shell**: Orchestrates I/O, calls core with data from adapters
- **Ports**: Interfaces defining what adapters must implement
- **Adapters**: Concrete implementations (Gist, Open Cloud HTTP, etc.)

## Testing Requirements (NON-NEGOTIABLE)

Every line of production code must be written in response to a failing test.

**RED → GREEN → REFACTOR:**

1. **RED:** Write failing test for desired behavior
2. **GREEN:** Write minimum code to pass
3. **REFACTOR:** Assess if refactoring adds value (commit before refactoring)

**Git history must show TDD compliance.**

**Test levels:**

| Layer    | Test with         | Isolation     |
| -------- | ----------------- | ------------- |
| Core     | Unit tests        | None needed   |
| Shell    | Integration tests | Fake adapters |
| Adapters | Adapter tests     | nock for HTTP |
| E2E      | Scenario tests    | Real APIs     |

**Coverage**: 100% required (statements, branches, functions, lines)

**Naming**: `it("should <behavior>")` - enforced by ESLint

**Anti-patterns (will be rejected):**

- Writing implementation before tests
- Testing mock behavior instead of real behavior
- Mocking without understanding dependencies

### Public API examples

Add a JSDoc `@example` block to any symbol exported from a package's
`src/index.ts` barrel **where the example adds value** — i.e. the usage is
non-trivial, has surprising edge cases, or the return shape isn't obvious from
the signature. Skip `@example` on pass-through re-exports and trivial getters.

Examples are dual-purpose:

- `pnpm gen:example-tests` compiles every `@example` code block into an
  `it(...)` test in `<source>.example.spec.ts`. Each block must be a complete,
  runnable TypeScript snippet with imports, and should include `expect(...)`
  assertions that prove the claim.
- The same blocks are rendered into the public docs site by TypeDoc; the
  `typedoc-plugin-replace-text` plugin strips the vitest import and `expect`
  calls so readers see a clean usage sample.

Format:

````ts
/**
 * @example
 * ```ts
 * import { expect, it } from "vitest";
 * import { myFn } from "@bedrock/pkg";
 *
 * const result = myFn({ foo: 1 });
 * expect(result).toEqual({ ok: true });
 * ```
 */
````

One well-chosen `@example` is the target. Add a second only when a single
block genuinely cannot convey the behavior — e.g. a success case plus a
qualitatively different failure mode. More examples are not better; resist
the urge to enumerate permutations of the same call. If you find yourself
reaching for a third block, the symbol probably needs clearer types or a
split, not more docs.

See `docs/adr/003-testing-strategy.md` for full details.

## Key Decisions

See `docs/adr/` for full Architecture Decision Records.

- **TypeScript over Rust**: Community contribution accessibility
- **Open Cloud only**: ROBLOSECURITY is deprecated, Open Cloud is the future
- **GitHub Gists for state**: Zero external service, works with GITHUB_TOKEN
- **Multi-format config**: Support TS, JS, YAML, JSON via c12

## Common Commands

```bash
pnpm install           # Install dependencies
pnpm build             # Build for production
pnpm dev               # Watch mode
pnpm test              # Run tests
pnpm lint              # Check/fix linting
pnpm typecheck         # TypeScript validation
pnpm gen:example-tests # Generate *.example.spec.ts from @example JSDoc blocks
pnpm mutate:changed    # Mutation test files touched in the current git diff
```

### Running Bun directly against workspace source

Direct `bun` invocations of workspace code need `--conditions source` to
resolve cross-package imports without a prior build:

```bash
bun --conditions source packages/cli/src/index.ts
```

Workaround until [oven-sh/bun#28851](https://github.com/oven-sh/bun/issues/28851)
lands — drop the flag and this note afterwards.

## Development Workflow

### Before Committing

1. Run `pnpm gen:example-tests` (regenerate `*.example.spec.ts` from `@example` blocks)
2. Run `pnpm lint` (auto-fixes style issues)
3. Run `pnpm build` (must succeed)
4. Run `pnpm test` (must pass)
5. Run `pnpm typecheck` (must pass)
6. Run `pnpm mutate:changed` (no surviving mutants on touched `src/**` files)

### Pull Requests

PR titles must follow conventional commit format (e.g.
`feat(ocale): add result type`). This is enforced by CI.

### Creating Issues

Use GitHub issue templates for:

- Bug reports
- Feature requests
- Documentation improvements

### Making Architectural Decisions (MANDATORY)

**ADRs are mandatory before implementing architectural changes. No exceptions.**

An Architecture Decision Record (ADR) must be created BEFORE implementation when
ANY of these conditions apply:

1. **Technology Choices**: New dependencies, build tools, frameworks, or
   project-wide patterns
2. **Architectural Patterns**: New layers, boundaries, abstractions, or
   communication patterns
3. **External Integrations**: Third-party services, APIs, authentication, or
   state storage
4. **Data Models**: State persistence, serialization, configuration formats, or
   migrations
5. **Security & Constraints**: Authentication methods, security requirements, or
   secret management
6. **Developer Workflow**: CI/CD changes, testing requirements, or code
   generation
7. **Breaking Changes**: Backwards-incompatible API changes, deprecations, or
   removals

**What does NOT require an ADR**:

- Bug fixes that don't change architecture
- Tests for existing code
- Behavior-preserving refactors
- Documentation updates (unless changing doc strategy)
- Performance optimizations without new dependencies
- Features following existing patterns

**Process**:

1. Identify decision type from list above
2. Use `adr` agent to create ADR collaboratively
3. Follow methodological Q&A process (see below)
4. Get stakeholder approval if needed
5. Mark ADR as "Accepted" before implementation begins
6. Implement the change
7. Update ADR if implementation reveals new information

**For Claude Code**:

When user requests implementation meeting ANY trigger criteria above:

1. STOP before implementing
2. Inform user an ADR is required
3. Offer to use `adr` agent to create ADR collaboratively
4. Wait for approval before proceeding with implementation

**ADR Creation Process (Methodological Q&A)**:

The ADR process must be slow and methodological. No assumptions. The `adr` agent
guides through:

1. **Context Gathering**: Problem? Constraints? Current state? Who's affected?
2. **Options Exploration**: Alternatives? Pros/cons each? What if do nothing?
3. **Decision Criteria**: What matters most? Deal-breakers? Timeline? Risk?
4. **Consequences Analysis**: Positive outcomes? Trade-offs? Reversible? Future?
5. **Documentation Review**: Review draft, confirm accuracy, identify gaps

**Rules**:

- Ask questions one at a time for complex decisions
- Never assume - always confirm
- Use AskUserQuestion tool liberally
- Reference existing ADRs for consistency patterns
- Draft ADR incrementally through conversation, not all at once

**Rule of thumb**: If asking "should this be an ADR?" - it probably should be.

See `docs/adr/006-adr-enforcement.md` for full rationale.

## Constraints

1. **Open Cloud only**: Never use ROBLOSECURITY or legacy APIs
2. **No secrets in state**: State files contain only resource IDs (public data)
3. **Backwards compatibility**: Maintain Mantle migration path

## Documentation

| Location          | Purpose                           |
| ----------------- | --------------------------------- |
| `README.md`       | Project introduction, quick start |
| `ROADMAP.md`      | High-level vision and milestones  |
| `docs/adr/`       | Why decisions were made           |
| `docs/plans/`     | How features are implemented      |
| `docs/templates/` | Reusable document templates       |
