# Bedrock Project Context

## What is Bedrock?

Infrastructure-as-Code deployment tool for Roblox, written in TypeScript. Modern
replacement for [Mantle](https://github.com/blake-mealey/mantle) (Rust-based
tool no longer maintained).

## Architecture

- **Language**: TypeScript (ES modules)
- **Runtime**: Bun
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

**RED → GREEN → REFACTOR cycle:**

1. **RED:** Write failing test for desired behavior
2. **GREEN:** Write minimum code to pass
3. **REFACTOR:** Clean up while tests stay green

**Commit cadence:** The pre-commit hook (`hk`) runs lint, typecheck, test, and
build, so a pure-RED commit is rejected before it can land. Work RED → GREEN
in the working tree, then commit RED + GREEN **together** as one commit per
behaviour slice. REFACTOR lands as a separate commit only when refactoring
adds value for that slice.

**Git history must show TDD compliance — one commit per behaviour slice.**

**Test levels:**

| Layer    | Test with         | Isolation     |
| -------- | ----------------- | ------------- |
| Core     | Unit tests        | None needed   |
| Shell    | Integration tests | Fake adapters |
| Adapters | Adapter tests     | Injected fake transport (e.g. `fakeFetch`, `@bedrock-rbx/ocale/testing`) |
| E2E      | Scenario tests    | Real APIs     |

**Coverage**: 100% required (statements, branches, functions, lines)

**Naming**: `it("should <behavior>")` - enforced by ESLint

**Anti-patterns (will be rejected):**

- Writing implementation before tests
- Testing mock behavior instead of real behavior
- Mocking without understanding dependencies
- Suppressing surviving mutants with `Stryker disable` directives. Kill the mutation with a test or refactor the code so a test can observe it.

### Public API examples

Add a JSDoc `@example` block to any symbol exported from a package's
`src/index.ts` barrel **where the example adds value** — i.e. the usage is
non-trivial, has surprising edge cases, or the return shape isn't obvious from
the signature. Skip `@example` on pass-through re-exports and trivial getters.

Examples are dual-purpose:

- `pnpm gen:example-tests` compiles every `@example` code block into an
  `it(...)` test in `<source>.example.spec.ts`. The generator prepends
  `import { expect, it } from "vitest";` as a file header, so source blocks
  **omit** that import -- include only the imports for the symbols being
  demonstrated. Each block should include `expect(...)` assertions that
  prove the claim.
- The same blocks are rendered into the public docs site by TypeDoc;
  `typedoc-plugin-replace-text` strips `expect(...)` lines (and any stray
  vitest import, as a safety net) so readers see a clean usage sample.

Format:

````ts
/**
 * @example
 * ```ts
 * import { myFn } from "@bedrock-rbx/pkg";
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

## Type Conventions

These conventions shape how new code is written and reviewed in this repo.

- **`JSONValue` is an ambient global** provided by `better-typescript-lib`
  (loaded via `@isentinel/tsconfig`'s `libReplacement: true`). It is the
  return type of `JSON.parse` and the canonical "any parsed JSON shape"
  type across the repo. Do not annotate `JSON.parse` call sites as
  `: unknown`, and do not propose `type-fest`'s `JsonValue` as a
  substitute: the ambient type is already in scope everywhere the base
  tsconfig is extended.

- **Wire types express nullability as `T | undefined`**, not `T | null`,
  because `unicorn/no-null` is enforced under `src/**`. Parsers (for
  example `parseGamePassResponse`) normalize JSON `null` to `undefined`
  at the wire boundary so public types only surface `undefined`. When
  an interface describes a raw wire body that is consumed without a
  parser (error response types, for example), document the null-vs-absent
  distinction at the declaration rather than widening the type to
  `| null`.

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
bun --conditions source packages/bedrock/src/index.ts
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

PR titles are linted by commitlint (`.github/workflows/lint-pr-title.yaml`) —
**verify both rules before `gh pr create` / `gh pr edit --title`:**

1. **Subject lower-case**: kebab-case every uppercase letter after
   `type(scope):`, including code identifiers (`mergeConfig` → `merge-config`,
   `GamePassesClient` → `game-passes-client`).
2. **Scope-enum**: if a scope is present it MUST be one of
   `core, deps, e2e, global, ocale, testing, tsconfig, vite, website`.
   The `bedrock` package was renamed to `@bedrock-rbx/core`, so changes in
   `packages/bedrock/` take the `core` scope. `ci`, `chore`, `docs`,
   `build`, `refactor` are **types, not scopes** — write `ci: …` with no
   scope, not `fix(ci): …`.
3. **Consumer-useful subject**: PR titles become changelog entries for
   people installing the published package. Write what *changed in the
   package from the consumer's perspective*, not how the work was organised.
   Internal terminology (`slice-1`, `post-merge cleanup`, `finalize`,
   `wire up`, issue numbers, sub-task names) is meaningless in a
   changelog. Prefer concrete, outcome-focused phrasing: `add game-passes
   client` over `slice-1 client implementation`; `clean up public jsdoc`
   over `post-merge cleanup`. If the change is invisible to consumers
   (pure internal refactor, docs-only), say what actually changed
   (`remove internal references from public jsdoc`) rather than labelling
   the pass.

### Creating Issues

Use GitHub issue templates for:

- Bug reports
- Feature requests
- Documentation improvements

### Making Architectural Decisions

Bedrock is pre-1.0, unpublished, and solo-maintained. ADRs are for decisions
a future maintainer could not reconstruct from the commit, PR body, and code.
Default to no ADR.

**Write an ADR when the decision is one of:**

1. **Package or technology choice.** Selecting between candidates where the
   tradeoffs mattered (c12 vs cosmiconfig, Stryker vs mutmut, Vite vs tsup),
   or adopting something that locks the project into a vendor, paradigm, or
   runtime whose removal would require redesign (Effect-TS, a DI container).
   A utility with no meaningful alternative considered (nanoid, a type-only
   package, a test helper) does not qualify.
2. **New category of integration.** A new auth mechanism, state backend, or
   API provider. A new endpoint on an existing Open Cloud client does not
   qualify.
3. **Cross-package pattern.** A new port, layer, or boundary that other
   packages must adopt. One more adapter inside an established port does
   not qualify.
4. **State or wire contract.** State file shape, serialization format, config
   schema, or diff algebra changes.
5. **Security.** Auth flow, secret handling, or trust boundary.
6. **Mandatory developer policy.** A new required check, test level, or
   commit gate. CI tweaks and retuning existing tooling do not qualify.
7. **Breaking change post-publish.** Only once bedrock is published to npm.
   Before that, downstream consumers do not exist.

**Gray-zone calibration:**

| Scenario                                             | ADR? |
| ---------------------------------------------------- | ---- |
| New endpoint on an existing Open Cloud client        | no   |
| New Open Cloud auth flow                             | yes  |
| `pnpm add nanoid` (no alternative considered)        | no   |
| Choosing c12 over cosmiconfig for config loading     | yes  |
| Adopting Effect-TS or equivalent                     | yes  |
| Tuning Stryker thresholds                            | no   |
| Requiring mutation testing on CI                     | yes  |
| New resource kind following ADR-018/019 pattern      | no   |
| New resource kind that needs its own diff algebra    | yes  |

**Never ADR:** bug fixes, tests, behavior-preserving refactors, docs,
performance tweaks.

**Process when an ADR is warranted:**

1. Use the `adr` agent. Brainstorm collaboratively; do not auto-generate.
2. Walk the Q&A: context, options, criteria, consequences, review. One
   question at a time; never assume.
3. Draft incrementally. Mark Accepted before implementation.
4. After Accepted, evolve via dated amendments, never retroactive rewrites
   of Decision or Consequences.

See `docs/adr/006-adr-enforcement.md` for full rationale and the 2026-04-23
amendment recalibrating the bar.

## Constraints

1. **Open Cloud only**: Never use ROBLOSECURITY or legacy APIs
2. **No secrets in state**: State files contain only resource IDs (public data)
3. **Backwards compatibility**: Maintain Mantle migration path

## Documentation

| Location          | Purpose                           |
| ----------------- | --------------------------------- |
| `README.md`       | Project introduction, quick start |
| `docs/adr/`       | Why decisions were made           |
| `docs/plans/`     | How features are implemented      |
| `docs/templates/` | Reusable document templates       |

## Agent skills

### Issue tracker

GitHub Issues at `christopher-buss/bedrock` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical defaults (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). Source of truth for label definitions: `.github/labels.yaml`. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context monorepo. Per-package `CONTEXT.md` under `packages/<pkg>/`, system-wide ADRs at `docs/adr/`. Pointer index at `CONTEXT-MAP.md`. See `docs/agents/domain.md`.
