# Bedrock Review Rubric

This rubric is shared between the CI Claude reviewer (via `.github/workflows/claude-review.yaml`) and the sandcastle reviewer (via `.sandcastle/review-prompt.md`). Both load this file verbatim. The wrapper around it tells you whether to post comments (CI) or commit fixes directly (sandcastle).

Walk every section. Apply `CLAUDE.md` conventions throughout; consult `docs/adr/` and per-package `CONTEXT.md` for domain specifics.

## 1. Architecture (FCIS pattern)

Bedrock follows Functional Core, Imperative Shell with explicit Ports.

- **Core**: pure functions only. No I/O, no side effects, no global state. Easy to test without fakes.
- **Shell**: orchestration only. Calls into core with data fetched from adapters.
- **Ports**: interfaces defining adapter contracts.
- **Adapters**: concrete I/O implementations (HTTP, Gist, c12, etc.).

Flag:

- I/O or side effects inside Core
- Business logic inside Shell or Adapters
- Direct adapter calls bypassing the port abstraction
- New cross-package coupling without a port

## 2. Testing discipline

- Every line of production code in a commit must be exercised by a test in the same commit. No premature scaffolding.
- RED + GREEN must land in one commit (the pre-commit hook rejects pure RED). REFACTOR is a separate commit, only when it adds value for that slice.
- 100% coverage on touched files (statements, branches, functions, lines).
- Test names use `it("should <behavior>")` and describe the contract, not the formula. Prefer `it.for` over `it.each`. Collapse truth-table tests where the contract is one rule.
- Use jest-extended matchers (`toThrowWithMessage`, `toBeFunction`, `toBeTrue`/`toBeFalse`, `toBeNil`) wired via `@bedrock/testing/jest-extended`, not `jest-extended` directly.
- Use `assert()` from vitest to narrow `Result` unions; do not reach for `as` casts in tests.
- Cleanup uses vitest `onTestFinished`, not `try/finally`. Register the restore callback before the mutation.
- No dynamic in-process imports in tests (`vi.resetModules() + await import(...)`). Static-import at the top, or spawn a subprocess for module-evaluation purity tests.
- No `// Stryker disable` directives. Kill the surviving mutant with a test or delete the dead code.

Test isolation by layer:

| Layer    | Test with         | Isolation                                                              |
| -------- | ----------------- | ---------------------------------------------------------------------- |
| Core     | Unit tests        | None needed                                                            |
| Shell    | Integration tests | Fake adapters                                                          |
| Adapters | Adapter tests     | Injected fake transport (e.g. `fakeFetch`, `@bedrock/ocale/testing`)   |
| E2E      | Scenario tests    | Real APIs                                                              |

## 3. Type conventions

- `JSONValue` is ambient (from `better-typescript-lib` via `@isentinel/tsconfig`'s `libReplacement: true`). Do not annotate `JSON.parse` call sites as `: unknown`. `Reflect.get` already returns `unknown` after object-narrowing.
- Wire types use `T | undefined`, never `T | null`. `unicorn/no-null` is enforced under `src/**`. Parsers normalize JSON `null` to `undefined` at the wire boundary.
- No `as` type assertions unless there is genuinely no alternative; fix the types instead.
- Prefer `satisfies` over annotation: `const x = {...} satisfies T` not `const x: T = {...}`.
- Use type tests in `*.spec-d.ts` with `expectTypeOf` for public API surface.

## 4. Public API documentation

- Symbols exported from a package's `src/index.ts` get a JSDoc `@example` block when usage is non-trivial. Skip on pass-through re-exports and trivial getters.
- `@example` blocks compile into `*.example.spec.ts` via `pnpm gen:example-tests`. Source blocks must NOT include the `vitest` import (the generator prepends it). Place `@example` after `@template`/`@param`.
- One well-chosen `@example` per symbol; resist enumerating permutations.
- No ADR references in code or rendered JSDoc. ADRs are internal governance; rendered docs ship to consumers.
- Bedrock is pre-1.0 and unpublished; do not frame type widenings as "breaking for plugin authors" in JSDoc and do not speculate about semver bumps.

## 5. Commit and PR format

- Conventional commit: `type(scope): subject`. Subject kebab-case; kebab every uppercase letter after the colon, including code identifiers (`mergeConfig` -> `merge-config`, `GamePassesClient` -> `game-passes-client`).
- Scope from the enum: `core, deps, e2e, global, ocale, testing, tsconfig, vite, website`. `ci`, `chore`, `docs`, `build`, `refactor` are types, NOT scopes (write `ci: ...` with no scope).
- No em-dashes (`—`) in commit messages, PR bodies, code comments, or docstrings.
- PR title is consumer-facing changelog text. Write what changed in the package from the consumer's perspective; avoid internal terminology like `slice-1`, `post-merge cleanup`, issue numbers, sub-task names.

## 6. Security and constraints

- Open Cloud only. No ROBLOSECURITY or legacy Roblox APIs.
- No secrets in state files. State holds resource IDs only (public data).
- No injection vulnerabilities, credential leaks, or unchecked external input at adapter boundaries.

## 7. Other rejection criteria

- No `knip` ignore directives.
- No manual `package.json` `exports` or `publishConfig.exports` edits (these are auto-generated by `vp pack`; new subpaths go in `vite.config.ts` `pack.entry` only).
- No `allowDefaultProject` globs in tsconfig. For out-of-project TS files, add a `tsconfig.json` with `include`.
- Prefer immutable accumulation (`reduce`/`filter`/`map`) over mutable loop accumulators.

## 8. Maintain balance

Avoid over-simplification that would reduce clarity or maintainability, create overly clever solutions, combine too many concerns into one function, remove helpful abstractions, or make debugging harder. When in doubt, match the established sibling pattern rather than forking it.
