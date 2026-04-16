# ADR-015: Mutation Testing with StrykerJS

**Date:** 2026-04-16  **Status:** Accepted

Decision Makers: Maintainer  
Tags: testing, quality, developer-workflow, mutation-testing, stryker

## Context

Bedrock mandates 100% code coverage (ADR-003). Coverage proves tests *execute*
every line — it does not prove they *assert meaningfully* on the behavior those
lines implement. Tests can satisfy coverage thresholds while checking nothing
consequential: a test that calls a function and discards the return value covers
the line but cannot kill a mutant that changes what the function returns. This
is "coverage theater" — a false sense of security that TDD discipline alone does
not structurally prevent.

Mutation testing addresses this gap by injecting small faults (mutants) into
production code and verifying the test suite catches them. A surviving mutant
means a test exists that touches the mutated line but does not assert on the
behavior being mutated. In an AI-assisted project where generated code is the
norm, this signal is especially valuable: the same workflow pressure that
produces high coverage can also produce tests that are structurally sound but
semantically hollow.

The project's existing tooling provides no equivalent signal. Vitest's coverage
provider (v8) counts execution, not assertion quality. The gap is real and has
no in-band solution.

The decision to adopt StrykerJS also surfaces a secondary structural issue:
`packages/vite-config` currently exports a `vitest-setup` entry
(`src/jest-extended.ts`) that registers jest-extended matchers at runtime.
This is test runtime behavior — not a Vite or Vitest configuration object —
and does not belong in a package named `vite-config`. The natural home for
both the shared Stryker config and the migrated `jest-extended.ts` setup is a
dedicated `@bedrock/testing` package.

### Stryker technical facts relevant to this decision

- `@stryker-mutator/vitest-runner` integrates with the existing Vitest setup
  without a separate test runner installation.
- `--mutate "path:L1-L2"` line-range syntax restricts mutation to lines touched
  in the current diff, making on-demand runs cheap proportional to diff size.
- `--incremental` persists results to `reports/stryker-incremental.json` and
  skips re-running mutants whose covering tests have not changed.
- `coverageAnalysis: "perTest"` is forced by the Vitest runner and enables
  Stryker to map each test to the mutants it covers, allowing per-test
  re-execution rather than full-suite re-execution per mutant.
- Stryker does not have a `--since <git-ref>` flag (Ruby's `mutant` does);
  deriving changed-file line ranges from `git diff` output requires a wrapper
  script.
- Stryker's own guidance and repository convention: `reports/` should be
  gitignored, not committed. The incremental cache file changes on every run
  (new hashes, mutant IDs, timestamps) and scales with mutant count — committed
  cache guarantees merge conflicts and should not be treated as source code.

## Decision

Adopt **StrykerJS with `@stryker-mutator/vitest-runner`** for mutation testing,
scoped to `packages/open-cloud` initially. The first PR adds Stryker with
local-only invocation via `pnpm mutate:changed`. Adding CI is a normal
follow-up PR and does not require a new ADR — it is scope sequencing, not an
architectural change excluded by this decision.

Concretely:

- **New package `@bedrock/testing`** (`packages/testing/`): shared home for
  test-adjacent concerns. Structured as TypeScript source with no build step,
  following the pattern of `@bedrock/vite-config`. Initial contents:
  - `src/jest-extended.ts` — migrated from `packages/vite-config/src/jest-extended.ts`.
    Registers jest-extended matchers on Vitest's `expect`. Consumers update
    their `setupFiles` import from `@bedrock/vite-config/vitest-setup` to
    `@bedrock/testing/jest-extended`.
  - `src/stryker.ts` — shared Stryker configuration, extended by per-package
    `stryker.config.ts` files.
  - Future home for shared test helpers, custom matchers, and fake factories.
- **`packages/vite-config`** drops the `./vitest-setup` export and its
  `src/jest-extended.ts` file. Vite-config retains only Vite and Vitest
  configuration objects.
- **Wrapper script**: `scripts/mutate-changed.ts` at repo root. Derives changed
  line ranges from `git diff HEAD`, constructs `--mutate "path:L1-L2"` arguments,
  and invokes Stryker. Hard-errors on unexpected conditions (new files with no
  prior HEAD, renames, binary files). No fallback to full-package mutation —
  loud failure is preferred so issues surface immediately. Minimizes surface
  area: only line-range derivation; all mutation logic remains in Stryker.
- **Trigger**: `pnpm mutate:changed` at repo root. Not wired into `pnpm test`,
  not run by git hooks. On-demand after tests pass. CI integration is a
  follow-up implementation step, not an architectural exclusion.
- **Failure mode**: exit non-zero if any mutant survives. No percentage
  thresholds — noisy on small diffs, and the mandate is zero survivors, not
  an acceptable rate.
- **Incremental cache**: `reports/` added to `.gitignore` (rationale in Context).
- **Relationship to coverage**: mutation testing and 100% coverage are
  independent, both mandatory. Coverage proves execution; mutation testing
  proves assertion quality. Neither replaces the other.

## Consequences

### Positive

- Guards against coverage theater: a test suite that kills all mutants is
  demonstrably asserting on behavior, not just touching lines.
- Proportional cost: `--mutate` with line ranges means on-demand runs are
  cheap for small diffs, making regular use realistic.
- No new test runner: Vitest runner reuses the existing Vitest setup.
- Incremental cache makes re-runs after minor changes fast.
- Scoped rollout: `open-cloud` is the pilot; other packages opt in only when
  the signal proves valuable.
- `@bedrock/testing` corrects an existing misfiling: `jest-extended.ts` moves
  from a package named after a build tool to a package named after testing.
  Future shared test utilities have a clear, appropriate home.

### Negative

- Mutation testing is inherently expensive at scale. Full-package runs on
  `open-cloud` could be slow; the line-range approach mitigates but does not
  eliminate this.
- Wrapper script (`scripts/mutate-changed.ts`) is a necessary evil — custom
  code that must be maintained. Risk is mitigated by pinned dependencies
  (catalog versioning means Stryker CLI changes surface at upgrade time, not
  randomly) and by minimizing the script's surface area.
- Until a CI workflow is added in a follow-up PR, mutation quality is enforced
  locally only. A contributor could merge code that survives mutants if they
  don't run `pnpm mutate:changed`. This is a scope choice for the initial
  implementation, not an architectural decision — adding CI does not require a
  new ADR.
- `coverageAnalysis: "perTest"` requires `threads: true` in Vitest; browser
  mode is not supported. These are Vitest runner constraints, not Stryker
  constraints.
- Migrating `jest-extended.ts` out of `@bedrock/vite-config` requires updating
  all `setupFiles` references in consumer packages. Low risk (mechanical find-
  and-replace, caught by typecheck), but a required step that touches multiple
  packages.

### Neutral

- `reports/` is gitignored. Cache is per-machine. Periodic `stryker run --force`
  is needed to prevent incremental cache drift as mutant IDs and source ranges
  shift across refactors.
- If Stryker upstream adds `--since <git-ref>`, `scripts/mutate-changed.ts`
  becomes deletable. The ADR's decision stands; the implementation detail
  simplifies.
- CI integration mechanism (direct GitHub Actions, Stryker Dashboard baseline,
  artifact cache) is an implementation detail to be decided when the follow-up
  PR is scoped. It does not alter the architectural decision captured here.

## Alternatives Considered

### Custom mutation tool (Uncle Bob approach)

A bespoke mutation framework built on the project's own test infrastructure.

**Rejected.** Bedrock is a side project. Building and maintaining a custom
mutation engine is not a justified cost when StrykerJS provides the same signal.
The custom approach was explicitly considered and declined in favor of an
existing solution.

### Separate `@bedrock/stryker-config` package

A single-purpose package for shared Stryker configuration only, mirroring
`@bedrock/vite-config`'s structure precisely.

**Rejected.** A standalone stryker-config package would leave `jest-extended.ts`
misplaced in `@bedrock/vite-config` and add two small packages (one for stryker
config, one for... what?) rather than one cohesive testing package. `@bedrock/testing`
provides a clear, lasting home for all test-adjacent concerns that do not belong
in a build tool config package.

### Do nothing — rely on 100% coverage alone

Keep the current coverage mandate without adding mutation testing.

**Rejected.** 100% coverage cannot distinguish between tests that assert on
behavior and tests that merely execute code. The coverage theater failure mode
is real, reproducible, and structurally invisible to coverage tooling. The cost
of doing nothing is accepting a known gap in the testing guarantee.

### Stryker without a wrapper script (full-package runs only)

Run `stryker run` on the entire `open-cloud` package on demand, no line-range
scoping.

**Rejected** as the default mode. Full-package runs are expensive and would
discourage regular use. The wrapper script's line-range approach is what makes
on-demand mutation testing practical. Full-package runs remain possible via
direct `stryker run` invocation when needed (e.g. before a release).

## Implementation Notes

**Files to create/modify:**

- `packages/testing/` — new package with `src/jest-extended.ts` (migrated from
  `packages/vite-config/src/jest-extended.ts`) and `src/stryker.ts` (new shared
  Stryker config)
- `packages/vite-config/` — remove `src/jest-extended.ts` and the
  `./vitest-setup` export
- All `setupFiles` consumers — update import from
  `@bedrock/vite-config/vitest-setup` to `@bedrock/testing/jest-extended`
- `packages/open-cloud/stryker.config.ts` — new, extends shared config
- `scripts/mutate-changed.ts` — new wrapper (pattern: `scripts/merge-coverage.ts`)
- Root `package.json` — add `"mutate:changed": "bun scripts/mutate-changed.ts"`
- `.gitignore` — add `reports/` if not already present

**Dependencies:** Add `@stryker-mutator/core` and `@stryker-mutator/vitest-runner`
as dev dependencies in `packages/open-cloud`.

**Verification:**

- Tests remain green after jest-extended migration (no behavior change)
- `pnpm mutate:changed` with no diff exits successfully (no mutants to run)
- `pnpm mutate:changed` after introducing a survivable test (weakened assertion)
  exits non-zero

ADR-006 requires this ADR to be accepted before implementation begins.

## Related Decisions

- **ADR-003**: Testing Strategy — mutation testing augments, does not replace,
  the 100% coverage mandate and TDD discipline established there.
- **ADR-008**: Zero Runtime Dependencies — `@stryker-mutator/core` and
  `@stryker-mutator/vitest-runner` are dev dependencies only. ADR-008's
  constraint is unaffected.
- **ADR-014**: Vite+ Unified Toolchain — `pnpm mutate:changed` is a separate
  script, not routed through `vp`. Stryker invokes Vitest internally; it does
  not use `vp test`.

## References

- [StrykerJS documentation](https://stryker-mutator.io/docs/stryker-js/introduction)
- [@stryker-mutator/vitest-runner](https://stryker-mutator.io/docs/stryker-js/vitest-runner)
- [Stryker incremental mode](https://stryker-mutator.io/docs/stryker-js/incremental)
- [Announcing StrykerJS incremental mode](https://stryker-mutator.io/blog/announcing-incremental-mode/)
- [Stryker configuration reference](https://stryker-mutator.io/docs/stryker-js/configuration/)
- ADR-003 (testing strategy this augments)
- ADR-014 (toolchain context)
