# Coding Standards

<!-- Loaded by the reviewer agent via @.sandcastle/CODING_STANDARDS.md.
     The reviewer does NOT have CLAUDE.md in context, so anything review
     should enforce belongs here (or behind the @-pointers below). -->

The architectural rubric (FCIS layering, TDD requirements, test
isolation by layer, Open Cloud security constraints, code quality)
lives in `@.claude/prompts/review-prompt.md`. Read that first.

The full project context (type conventions, commit/PR rules, ADR
process, common commands) lives in `@CLAUDE.md` and `docs/adr/`.

The rules below are review-time invariants those files do not cover and
that are easy to miss from a diff alone.

## Style

- File names and identifiers in PR titles use kebab-case; commitlint
  rejects uppercase after `type(scope):`.
- Do not use em-dashes (`—`) in prose, comments, docstrings, commit
  messages, or PR bodies.
- Wire types use `T | undefined`, never `T | null`. Parsers normalize
  JSON `null` to `undefined` at the boundary.
- Do not annotate `JSON.parse` call sites as `: unknown`. The ambient
  `JSONValue` from `better-typescript-lib` is already in scope.
- Do not use `as` type assertions unless there is no alternative. Fix
  the types instead.

## Testing

- Tests describe observable behavior, not formulas. Prefer `it.for` over
  `it.each`. Collapse truth-table tests where the contract is one rule.
- Use jest-extended matchers (`toThrowWithMessage`, `toBeFunction`,
  `toBeTrue`/`toBeFalse`, `toBeNil`) over verbose built-ins. Wire via
  `@bedrock/testing/jest-extended`, not the package directly.
- Use `assert()` from vitest to narrow `Result` unions in tests; do not
  reach for `as` casts.
- Cleanup uses vitest `onTestFinished`, not `try/finally`. Register the
  restore callback before the mutation.
- No dynamic in-process imports (`vi.resetModules() + await import(...)`)
  in tests; static-import at the top, or spawn a subprocess for
  module-evaluation purity tests.
- No `// Stryker disable` directives. Kill the surviving mutant with a
  test or delete the dead code.

## Architecture

- Prefer immutable accumulation (`reduce`/`filter`/`map`) over mutable
  loop accumulators.
- Public API symbols (exported from a package's `src/index.ts`) get a
  JSDoc `@example` block when usage is non-trivial. Do not include the
  `vitest` import in source `@example` blocks; the generator prepends
  it. Place `@example` after `@template`/`@param`.
- No ADR references in code or rendered JSDoc. ADRs are internal
  governance; rendered docs ship to consumers.
- No `knip` ignore directives.
