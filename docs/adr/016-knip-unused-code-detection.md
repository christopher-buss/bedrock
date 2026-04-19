# ADR-016: Knip for Workspace-Level Unused Code Detection

**Date:** 2026-04-17  **Status:** Accepted

Decision Makers: Maintainer  
Tags: developer-workflow, tooling, quality, monorepo, knip

## Context

Bedrock has two existing signals that touch on "unused code" but neither
covers the problem end to end.

**Signal 1 — 100% coverage (ADR-003).** Vitest's v8 coverage proves every
line is *executed* by the test suite. It does not prove a line is reachable
from a real consumer: a test can import an internal symbol, exercise it, and
satisfy the coverage threshold even if no shipped code path depends on that
symbol. This is a cousin of the "coverage theater" gap ADR-015 addresses
with mutation testing — tests keep dormant code alive.

**Signal 2 — `unplugin-unused` via tsdown (`packages/vite-config/src/index.ts:18`).**
The shared Vite+ `pack` config sets `unused: { level: "error" }`, which wires
`unplugin-unused` into the bundle step. During `vp pack`, tsdown fails the
build if it finds unused imports, unused exports within the bundle graph, or
entries in the package's own `dependencies` / `peerDependencies` that no
transformed source file imports. Coverage is real but scoped to a single
tsdown build: the plugin inspects only the files the bundler pulls through
`transform` from that build's entry points (`src/index.ts` and the subpath
export entries per ADR-011), reads only that package's `package.json`, and
cannot correlate findings across packages. `devDependencies` are not
checked by default, and imports of packages missing from `package.json`
entirely (unlisted deps) are not flagged.

Several rot categories are therefore uncovered:

1. **Orphan files.** A source file not reachable from any entry point sits
   untouched in `src/` indefinitely. Tests don't cover it (not imported),
   coverage ignores it (excluded from the graph), `unplugin-unused` never
   sees it (never passes through `transform`), and ESLint doesn't complain
   because the file itself is syntactically valid.
2. **Cross-package / workspace-level unused public exports.**
   `@bedrock/open-cloud/game-passes` is a subpath entry. `unplugin-unused`
   treats it as a package *output* and keeps everything reachable from it.
   It cannot tell that no workspace consumer (`apps/e2e`, `apps/website`,
   other packages) actually imports `./game-passes`. An entire subpath
   export can be dead at the workspace level while looking alive at the
   package level.
3. **`devDependencies` and unlisted deps.** `unplugin-unused` defaults to
   `dependencies` + `peerDependencies`; a stale `devDependency` or a source
   file importing a package that is not declared anywhere in `package.json`
   slips past. The default is not currently configured to cover
   `devDependencies` in `packages/vite-config`, and no signal exists for
   unlisted imports at all.
4. **Workspace-level single-report view.** Findings from
   `unplugin-unused` surface during each package's `vp pack` run. There is
   no aggregated "unused across the monorepo" report — the data exists
   per-build-invocation, not per-workspace.

The monorepo also has four distinct consumer surfaces that any detector must
treat as entry points, or it will produce false positives that discredit the
tool:

- Every `package.json` `exports` entry across the seven packages (root `.`
  and all subpaths — `./game-passes`, etc. — per ADR-011).
- `apps/e2e` (scenario tests against real Open Cloud APIs) and
  `apps/website` (VitePress docs site). Both import from library packages.
- Root `scripts/*` (Bun scripts invoked by pnpm scripts — `generate-example-tests.ts`,
  `merge-coverage.ts`, `mutate-changed.ts`, `is-agent.ts`).
- Vitest test files and the generated `*.example.spec.ts` files (ADR-005).

A detector that does not enumerate these as entries will scream about
legitimately-consumed code and get silenced.

### Knip technical facts relevant to this decision

- Knip auto-reads `pnpm-workspace.yaml` and each `package.json` to discover
  workspaces, `exports` entries, `bin`, and `main`. Subpath exports are
  handled natively — no manual listing.
- Knip analyzes all workspaces via a shared module graph from a single
  root invocation, which is what lets it flag cross-workspace unused
  exports (e.g. a `@bedrock/open-cloud` subpath that no consumer
  imports). See the
  [monorepos guide](https://knip.dev/features/monorepos-and-workspaces).
- No `--affected` or `--changed` flag. Scoping is limited to
  `--workspace <name>` (which transitively pulls in ancestors/dependents
  unless `--strict`) and `--cache` (short-circuits unchanged portions of
  the analysis on repeat runs).
- Knip uses the standard TypeScript compiler API (`typescript` from
  `catalog:tsc`), not the `@typescript/native-preview` (tsgo) binary the
  repo uses for `typecheck:affected`. This is not a regression: knip
  needs AST and type information that tsgo's CLI does not expose. The
  two tools run independently against the same source.
- First-class issue categories for every rot category named above:
  unused files, unused exports, unused exported types, unused
  `devDependencies`, unlisted dependencies (imports with no `package.json`
  entry), and duplicate exports. Also re-checks `dependencies` /
  `peerDependencies` at workspace scope, a strict superset of
  `unplugin-unused`'s per-build check.
- Plugin system auto-configures for common tools (Vitest, ESLint, VitePress,
  Stryker). The VitePress plugin understands `apps/website`'s entry
  structure; the Vitest plugin treats `*.test.ts`/`*.spec.ts` as entries.
- Single config file at repo root (`knip.json` or `knip.ts`) — no
  per-package config required for the majority of cases.
- Exit code semantics: non-zero when issues are found, matching the existing
  `hk` step contract (`check = "pnpm ..."`).
- JSDoc tag filtering via the `tags` config (arbitrary tags used as
  include/exclude markers, e.g. `tags: ["-internal"]` to skip exports
  marked `@internal`, or include-list mode to require a marker). Useful
  for library packages where a public export may be intentionally
  unconsumed in this repo but meant for external consumers.

## Decision

Adopt **knip** at the workspace root as a workspace-level unused-code
detector, complementary to the existing `unplugin-unused` build-time hook
and the 100% coverage mandate.

Concretely:

- **Install**: `knip` as a root `devDependency` via a new `catalog:lint`
  entry. No per-package installs — knip is invoked once from the
  workspace root.
- **Config**: `knip.json` at repo root with `$schema` for IDE
  completion. `knip.ts` is only needed when config is dynamically
  computed, which Bedrock does not need.
- **Workspace enumeration**: list each workspace explicitly under the
  root `knip.json`'s `workspaces` key. Per-workspace `entry`, `project`,
  and plugin overrides live inside the root file; the explicit list
  makes each workspace's config surface visible in one place.
- **Plugins**: enable knip's auto-detect plugins for Vitest and VitePress
  (cover `apps/website` and all `*.test.ts`/`*.spec.ts` files across
  the workspace). Explicitly list `scripts/**` as an entry for the
  loose Bun scripts invoked by pnpm scripts.
- **Performance**: run with `--cache` in the root script so repeat
  invocations (pre-push, CI on the same ref) short-circuit unchanged
  analysis.
- **Root script**: `"lint:unused": "knip --cache"` in root `package.json`.
- **Enforcement surface**: pre-push and `hk check` only. Not wired into
  any pre-commit tier. The existing pre-commit steps (`lint:affected`,
  `typecheck:affected`, and the agentic `test:affected` / `build:affected`
  tier) all scope via the affected graph; knip cannot (it has no
  `--affected` flag), so placing it in pre-commit would add the first
  unscoped gate to a hook hot-path that has been deliberately kept
  scoped. Pre-push runs unscoped checks for all authors already
  (ADR-013); knip fits there without changing the tier's character.
- **Pre-push (all authors)**: new hk step `unused` added to `hk.pkl`,
  `exclusive = true`, `check = "pnpm lint:unused"`. Humans and agents
  alike hit it before push. The glob widens the `*.ts`/`*.tsx` pattern
  used by `lint` and `typecheck` to also include `package.json` and
  `pnpm-workspace.yaml` so the step triggers on manifest-only changes
  (e.g. adding an unused `devDependency` without touching source) —
  knip's remit covers manifest changes too.
- **CI via `hk check`**: same step added to the `check` hook
  unconditionally. CI invokes `hk check --all`, so every step runs
  regardless of what changed. No separate CI workflow change required.
- **Failure mode**: non-zero exit when any issue is found. No severity
  tiers, no warnings-only rollout. The tool is only added once the repo is
  clean against it (treated as an initial-commit prerequisite, not a
  discovery phase).
- **`unplugin-unused` stays.** It is already active at build time via the
  shared Vite+ config. Knip layers on top, not instead.

## Consequences

### Positive

- **The uncovered rot categories are caught.** Orphan files, workspace-level
  unused exports, unused `devDependencies`, and unlisted imports all surface
  in a single report. This complements `unplugin-unused`'s per-build
  coverage of unused imports/exports in the bundle graph and unused
  `dependencies`/`peerDependencies`.
- **Two tools, two scopes.** `unplugin-unused` enforces at build time
  per package; knip audits at lint time across the workspace. They
  overlap on `dependencies`/`peerDependencies`, where knip's
  workspace-wide read is a stricter superset of the per-build check.
- **Fits ADR-013's pre-push tier cleanly.** Unscoped checks belong at
  pre-push, where ADR-013 already runs lint/typecheck/test/build
  unconditionally for all authors. Knip joins that tier without adding
  a new hook primitive or a new agent-vs-human distinction.
- **Knip's `package.json` exports auto-detection means low config
  maintenance** for subpath entries. New subpath exports become entries
  the moment they are added to `package.json` without any config change.
  New workspace packages require a one-line addition to the explicit
  `workspaces` map in `knip.json`.
- **Plugin system covers the project's specific tools** (Vitest, VitePress,
  Stryker, ESLint). Out-of-the-box treatment of test files and docs entry
  points without hand-curated globs.

### Negative

- **Another dev dependency to track.** Knip is actively maintained and
  widely used, but it is a non-trivial tool with its own release cadence
  and config schema. Version pinning via the pnpm catalog mitigates drift.
- **Entry-point config must stay current.** Additions to `apps/` or
  `scripts/` that knip's defaults don't cover, and new workspace
  packages, require `knip.json` updates. Same class of maintenance as
  updating `hk.pkl` when adding a new hook step.
- **Initial audit may surface "is this supposed to be public?" questions.**
  Library packages sometimes export symbols meant for downstream consumers
  that are not yet used within the workspace. These need explicit
  `tags`-based allowlisting (choosing a JSDoc marker tag and configuring
  knip to require or exclude it) or entry-level exemption. The initial
  implementation PR must sort these before the tool can go green.
- **`knip` runs as its own CLI, not through `vp`.** Consistent with
  ADR-015's `mutate:changed`; see the ADR-014 entry in Related
  Decisions.

### Neutral

- **Knip's `--fix` mode is not adopted initially.** Auto-removal of unused
  exports/files/deps is available but not turned on — the initial workflow
  is report-and-fix-manually. Enabling `--fix` can be a follow-up.

## Alternatives Considered

### Do nothing — rely on `unplugin-unused` and 100% coverage alone

The current setup: tsdown errors on unused imports/exports within the bundle
graph, and coverage ensures every line is executed by tests.

**Rejected.** Leaves orphan files, workspace-level unused exports,
`devDependencies`, and unlisted imports uncovered, and limits
dependency-drift detection to per-build per-package scope. Both existing
signals are structurally blind to these categories. The gap is not
hypothetical — it grows with every merged PR.

### ts-unused-exports

Standalone CLI for detecting unused TypeScript exports.

**Rejected.** Exports only. No detection of unused deps or orphan files.
Adopting it would address one of three gaps and leave the other two for a
future tool, producing the same tooling fragmentation knip avoids.

### `eslint-plugin-import`'s `no-unused-modules` rule

ESLint rule flagging modules whose exports are not imported elsewhere.

**Rejected.** Same scope limitation as ts-unused-exports (exports/files only,
no deps). Additionally, ESLint's monorepo awareness is limited — the rule
does not natively understand pnpm workspace boundaries or `package.json`
exports, and configuring it to respect the subpath-export pattern from
ADR-011 is brittle. Knip's pnpm-workspace plugin handles this natively.

### depcheck

Standalone CLI for unused `package.json` dependency detection.

**Rejected.** Deps only. Would close one of the three gaps but require
pairing with a second tool for exports/files — exactly the fragmentation
knip's all-in-one coverage exists to avoid. depcheck is also notably
weaker on TypeScript and monorepo support than knip.

### Extend `unplugin-unused` to cover the gap

Reconfigure the existing `unplugin-unused` integration (e.g. adding
`devDependencies` to `depKinds`) and rely on it for the remaining
categories.

**Rejected.** Configuration can close the `devDependencies` gap but
cannot close the architectural gaps: `unplugin-unused` is a bundler
plugin that inspects only files the bundler traverses, per-build. Files
outside any bundle graph, workspace-level cross-package consumption, and
imports of unlisted packages are out of scope by design. Making it cover
these cases would mean rewriting it into a workspace-level static
analyzer — which is what knip already is.

### Custom workspace-level audit script

Hand-rolled Bun script that walks the workspace, resolves imports, and
reports orphans.

**Rejected.** Same "custom tooling" argument as ADR-015 made for mutation
testing: knip's correctness guarantee around subpath exports, TypeScript
path aliases, dynamic imports, and monorepo edge cases is worth more than
a weekend's worth of custom script work. Bedrock is a side project;
building a workspace-level static analyzer is not a justified cost.

### Adopt knip but run it CI-only (skip pre-push)

Install and configure knip but wire it only into the `hk check` hook
that CI invokes, not into any local pre-push hook. Contributors would
see violations only on the PR check.

**Rejected.** ADR-013 establishes pre-push as the tier where unscoped
checks (typecheck, test, build for humans) run locally before the commit
reaches the remote. Skipping pre-push would mean knip violations only
surface after a push-and-wait-for-CI cycle, breaking the ADR-013 contract
that the full gate runs locally first. Pre-push is the cheapest point at
which a contributor can discover and fix a violation without a remote
round-trip; removing it would be a regression in feedback loop quality
for a dubious reason (pre-push latency is already accepted for the
existing unscoped checks).

## Implementation Notes

**Files to create/modify:**

- `knip.json` (new, root) — knip config with `$schema` reference.
  Enumerate each workspace package under `workspaces` (packages/cli,
  packages/open-cloud, packages/testing, packages/typescript-config,
  packages/vite-config, apps/e2e, apps/website). Enable the Vitest
  and VitePress plugins globally; declare `scripts/**` as an explicit
  entry surface (it's a loose directory of Bun scripts with no
  `package.json`, not a true workspace despite the `scripts/*` line
  in `pnpm-workspace.yaml`). Rely on knip's `package.json`-exports
  auto-detection for library subpath entries (ADR-011).
- `package.json` (root) — add `"lint:unused": "knip --cache"` script;
  add `knip` under devDependencies (via `catalog:lint` entry in
  `pnpm-workspace.yaml`).
- `pnpm-workspace.yaml` — add `knip` to the `lint` catalog section at the
  latest stable version.
- `hk.pkl` — add a `local unused = new Step { ... }` mirroring the existing
  `test` and `build` locals (glob `*.ts`/`*.tsx`, `exclusive = true`,
  `check = "pnpm lint:unused"`). Wire it into `pre-push` unconditionally
  and into the `check` hook unconditionally. Do **not** add it to
  `pre-commit`.
- **Generated `*.example.spec.ts` files** — ADR-005 generates these from
  JSDoc `@example` blocks via `pnpm gen:example-tests`. Knip's Vitest
  plugin treats `*.spec.ts` as entry points by default, so they are
  covered without additional `entry` config. They must exist in the
  working tree before knip runs, or symbols consumed only by them will
  be flagged as unused — declare the new `unused` step after
  `gen-example-tests` in every hook that runs both.
- **Initial cleanup** — run `pnpm lint:unused` against a clean checkout
  (with generated example tests present) and resolve every finding
  (delete dead code, remove unused deps, mark intentionally-public-
  unconsumed exports with the appropriate JSDoc tag, or add targeted
  ignore entries in `knip.json` with a comment explaining why). Ship
  the cleanup and the knip adoption in the same PR so the tool goes
  green the moment it is merged.

**Verification:**

- `pnpm lint:unused` exits zero on a clean checkout.
- Introduce a throwaway unused export, unused file, and unused dep on a test
  branch — each is flagged by the tool and fails the `hk check` gate.
- `hk run pre-push` and `hk check` both execute the `unused` step;
  `hk run pre-commit` does not.
- Push a branch with a deliberate violation and confirm CI `hk check`
  fails on the new step.

ADR-006 requires this ADR to be accepted before implementation begins.

## Related Decisions

- **ADR-003**: Testing Strategy — 100% coverage is necessary but cannot
  distinguish executed-from-real-consumer from executed-from-test-only.
  Knip closes that gap at the workspace level, analogous to how ADR-015's
  mutation testing closes it at the assertion level.
- **ADR-008**: Zero Runtime Dependencies in `@bedrock/open-cloud` — knip is
  a dev dependency. ADR-008's constraint is not affected.
- **ADR-011**: Simplified Architecture for Library Packages — the subpath
  export pattern (`@bedrock/open-cloud/game-passes`) is the exact surface
  knip must preserve as entry points. Knip's `package.json` exports
  auto-detection handles this natively.
- **ADR-013**: hk for Git Hook Management — this ADR reuses ADR-013's
  unconditional pre-push + `hk check` tier for the `unused` step. It
  does **not** reuse the agentic `isAgent` pre-commit tier: every
  step in that tier scopes via the affected graph, and knip has no
  equivalent scoping flag. Pre-push is the correct tier for unscoped
  checks and requires no new hook primitive.
- **ADR-014**: Vite+ Unified Toolchain — knip runs outside `vp`, paralleling
  ADR-015's decision for `mutate:changed`. ADR-014's unification goal is
  scoped to build/test/orchestration; static analysis tools outside that
  scope remain standalone.
- **ADR-015**: Mutation Testing with StrykerJS — same "augment coverage
  with a complementary signal" framing. Knip addresses reachability;
  Stryker addresses assertion strength.

## References

- [Knip documentation](https://knip.dev/)
- [Knip — Monorepos & Workspaces](https://knip.dev/features/monorepos-and-workspaces)
- [Knip — Configuration reference](https://knip.dev/reference/configuration)
- [Knip plugin list](https://knip.dev/reference/plugins)
- [unplugin-unused](https://github.com/unplugin/unplugin-unused)
- [tsdown `unused` option](https://tsdown.dev/options/unused)
