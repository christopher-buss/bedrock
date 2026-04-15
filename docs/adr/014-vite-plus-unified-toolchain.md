# ADR-014: Vite+ as Unified Build, Test, and Task Toolchain

**Date:** 2026-04-15 **Status:** Accepted

Decision Makers: Maintainer Tags: developer-workflow, tooling, build, test, task-runner, vite-plus, voidzero

## Context

At the time of this decision, Bedrock's build, test, and task orchestration
stack consisted of four tools from adjacent ecosystems:

- **tsdown** for library builds (`packages/cli`, `packages/open-cloud`)
- **vitest** for unit and type tests, configured per-package via an
  `@bedrock/vitest-config` shared preset
- **vitepress** for the documentation site (`apps/website`)
- **turborepo** as the task runner, caching layer, and pipeline orchestrator

Each tool owned a distinct config file. Each cached against its own store. The
task graph lived in `turbo.json`, separate from any of the configs it invoked.
The result was a working stack — it built, it tested, it deployed — but one
that required keeping four config surfaces in sync and whose total complexity
was driven by the number of tools, not the size of the repo.

Two facts made the status quo feel increasingly provisional:

1. **Every tool Bedrock already used shared the same upstream gravity.** tsdown,
   vitest, and vitepress are all part of the same Vite-adjacent ecosystem. The
   fact that they were separate binaries with separate configs was a historical
   accident of the ecosystem's maturity, not a deliberate architectural choice.

2. **Bedrock has a concrete near-term intent to migrate from eslint to oxc.**
   The current linter, `@isentinel/eslint-config`, expresses rules that cannot
   yet be fully represented in oxlint — the migration is blocked on upstream
   PRs landing the missing rule support. When that unblocks, Bedrock will want
   to adopt oxlint (and likely oxformat) without introducing a fifth tool,
   fifth config file, and fifth cache.

[Vite+](https://vite.plus) (CLI: `vp`) is a unified toolchain maintained by
[voidzero](https://voidzero.dev) — the company behind Vite and Vitest — that
bundles tsdown-style library packing, vitest-style testing, oxc-style
linting/formatting, and a cached task runner behind a single CLI and a single
config file. Every current tool in Bedrock's stack is already inside it, and
so is the next tool Bedrock plans to adopt.

The forcing function, therefore, was not that the old stack was broken. It
was that the switching cost to vite-plus scales with repo size, and Bedrock is
still small. Migrating now is cheap; migrating after the repo grows, after
contributor muscle memory has formed around four separate configs, and after
CI has accumulated workflows keyed to turbo's task graph, would be
progressively more expensive for the same end state. The choice was between
paying the consolidation cost now, or paying a larger version of the same cost
later.

### The eslint interim

One seam is worth naming explicitly: `vp lint` runs oxlint, but Bedrock still
runs eslint. Until the upstream PRs that unblock the oxc migration land,
`pnpm lint` continues to invoke `eslint --cache .` directly, bypassing `vp`.
This is a deliberate split, documented as a known gap, and expected to close
when oxc becomes a drop-in replacement for `@isentinel/eslint-config`. It is
the only part of the developer workflow that is not routed through `vp`.

## Decision

Adopt **Vite+ (`vp`) as the unified build, test, and task-runner toolchain for
the Bedrock monorepo.** Remove turborepo and tsdown. Consolidate the shared
vitest preset into a shared vite-plus preset.

Concretely:

- **Task orchestration** moves from turborepo to `vp run`. The root
  `package.json` scripts use `vp run -r <task>` to fan tasks out across the
  workspace, with caching handled by `vp`'s built-in task cache (`run.cache`
  in the root config).
- **Library builds** move from tsdown to `vp pack`. `packages/cli` and
  `packages/open-cloud` each consume a shared `pack` config from
  `@bedrock/vite-config`.
- **Tests** continue to run on vitest, but invoked through `vp test`. Per-
  package `vitest.config.ts` files are deleted; each package instead re-
  exports `@bedrock/vite-config`'s shared config from its `vite.config.ts`.
  The root config uses `projects: ["packages/*", "apps/*"]` glob discovery
  instead of a hand-maintained project list.
- **The shared config package** is renamed from `@bedrock/vitest-config` to
  `@bedrock/vite-config` and now owns both the shared `pack` (build) config
  and the shared `test` config, consumed as TypeScript source with no build
  step of its own.
- **`vite` and `vitest` are pinned to the voidzero forks**
  (`@voidzero-dev/vite-plus-core` and `@voidzero-dev/vite-plus-test`) via
  workspace-level pnpm overrides, at the exact current version. This matches
  voidzero's own recommended install path of `@latest` plus Bedrock's
  project-wide policy of pinning dependencies to exact versions.
- **eslint remains outside `vp`** as described in the Context section, until
  the oxc migration unblocks.

## Consequences

### Positive

- **One toolchain, one CLI, one config per package.** Contributors learn `vp`
  and they can build, test, typecheck, and orchestrate tasks without context-
  switching between four tools.
- **Shared cache across tasks.** `vp run`'s task cache replaces turborepo's,
  covering build, test, and typecheck in the same store without a separate
  `turbo.json`.
- **Zero-cost oxc adoption when it lands.** Switching `pnpm lint` from direct
  eslint to `vp lint` will be a config flip, not a toolchain migration —
  oxlint is already wired into `vp` and the ancillary infrastructure
  (caching, staged-files integration, CI scripts) will already be in place.
- **Alignment with the ecosystem's direction.** Bedrock was already using
  tools in the Vite/Vitest/VitePress orbit; adopting the toolchain that
  voidzero themselves maintain puts the project on the canonical install
  path.
- **Smaller surface area in git.** The diff that introduces vite-plus also
  deletes `turbo.json`, per-package `vitest.config.ts` files, and tsdown
  config, net-reducing the repo's config footprint.

### Negative / eyes-open risks

- **Vite+ is pre-1.0 (`0.1.x`).** Breaking changes between minor versions are
  possible. Pinning is a mitigation — Bedrock is never implicitly on a newer
  version than it has tested against — but it is not a fix for the underlying
  volatility. The project accepts that upgrading vite-plus may require
  migration work on each bump until it reaches 1.0.
- **`vite` and `vitest` resolve to voidzero forks workspace-wide.** Any
  debugging against upstream vite or vitest issue trackers has to account for
  the fork layer. In practice the forks track upstream closely, but the
  indirection exists.
- **The eslint / `vp lint` split is visible.** `pnpm lint` routes around `vp`
  while every other developer-workflow command goes through it. Until oxc
  lands, the "Common Commands" story is "everything goes through vp, except
  lint." This is named and accepted, not hidden.
- **`vp pack` at the monorepo root fails.** The root `vite.config.ts` sets
  `pack: {}` to override the shared config's `pack.entry`, but vite-plus
  still attempts to pack when invoked directly there — the repo root is not
  a buildable package. CI is unaffected because the root has no `build`
  script, but anyone typing `vp pack` at the root by reflex will get a
  confusing error. The root config retains an explicit `pack: {}` and a
  comment naming this as intentional.

### Rollback path

If vite-plus regresses badly, is abandoned, or diverges from upstream vite in
a way that breaks Bedrock's needs, the path back is mechanical:

1. Remove the `vite` and `vitest` overrides from `pnpm-workspace.yaml`.
2. Reintroduce `tsdown` as a dev dependency in `packages/cli` and
   `packages/open-cloud`, and restore their `tsdown.config.ts` files.
3. Restore per-package `vitest.config.ts` files (or inline their content into
   each package's `vite.config.ts`).
4. Either reintroduce `turbo` + `turbo.json`, or run tasks via raw
   `pnpm -r run`.

At Bedrock's current size this is roughly a day of work. The cost grows with
the repo; doing the migration now, when rollback is still cheap, is part of
the reason the decision was made at this point in the project's life.

## Alternatives Considered

### Do nothing — stay on turbo + tsdown + vitest until oxc lands

Rejected. The end state — consolidated tooling that incorporates oxc —
arrives the same way regardless of when the migration happens. Deferring
means paying the consolidation cost against a larger repo, with more
accumulated turbo-specific infrastructure in CI and more contributor muscle
memory to retrain. The "do nothing" alternative trades present comfort for
future tax.

### Other consolidation plays (rslib/rsbuild, unbuild, manual oxc wiring)

Not seriously evaluated. Every component of vite-plus — tsdown-style pack,
vitest test runner, vitepress docs site, oxlint/oxformat — was already part
of Bedrock's current or planned stack. Picking a different unified toolchain
would have required *leaving* tools Bedrock already uses, not just adopting
new ones. The comparison was a no-brainer, not a bakeoff, and the ADR
documents it as such.

## Implementation Notes

- `@bedrock/vitest-config` is renamed to `@bedrock/vite-config`. The package
  is consumed as TypeScript source (its `main` and `types` point at
  `./src/index.ts`), so it has no build step of its own.
- `packages/cli/vite.config.ts` and `packages/open-cloud/vite.config.ts` each
  re-export the shared config via `mergeConfig(sharedConfig, {})`. The
  wrapper is deliberate — it provides a per-package entry point for future
  overrides — even though the second argument is currently empty.
- The root `vite.config.ts` sets `pack: {}` to prevent the root from
  inheriting the shared `pack.entry`, and uses
  `projects: ["packages/*", "apps/*"]` for vitest project discovery.
- The pnpm catalog layout is reshuffled to match the new tool distribution:
  a new `dev` catalog holds `oxc-minify` and `pncat`; a new `docs` catalog
  holds `vitepress` (previously in `build`); `vite-plus` lives in `build`.
- Direct Bun invocations against workspace source continue to require
  `--conditions source` per the existing CLAUDE.md workaround. Vite+'s
  shared `resolve.conditions` include `source` so vitest resolution works
  identically.
- `apps/e2e` has no typecheck script because the package currently contains
  no TypeScript files; the script will be restored when the first scenario
  lands. This is unrelated to vite-plus itself but is part of the same
  cleanup commit range.

## Related Decisions

- **ADR-001** (TypeScript with Bun Runtime) — unchanged. Bun remains the
  runtime; TypeScript remains the language. Vite+ runs on Node tooling under
  the hood but does not affect Bun's role in the project.
- **ADR-002** (Monorepo with Turborepo and FCIS + Ports Architecture) —
  **partially superseded**. The monorepo layout and FCIS + Ports architecture
  described in ADR-002 remain in effect. The Turborepo-specific task runner
  and `turbo.json` pipeline described there are replaced by `vp run`.
  ADR-002's title and its Turborepo-flavored sections should be read as
  historical context for the monorepo decision, not as current
  implementation.
- **ADR-003** (Testing Strategy) — unchanged in substance. Vitest remains the
  test runner; the RED/GREEN/REFACTOR discipline, coverage requirements, and
  observable-behavior testing workflow are unaffected. Only the config file's
  home and the CLI entry point have changed.
- **ADR-004** (Documentation Site) — compatible. VitePress still powers the
  docs site; it is now installed through the `docs` catalog rather than the
  `build` catalog but otherwise behaves identically.
- **ADR-013** (hk for Git Hook Management with Differentiated Gating) — the
  hk pre-commit and pre-push gates still invoke `pnpm test`, `pnpm typecheck`,
  and `pnpm build`. The only change is that those scripts now route through
  `vp run -r` internally; from hk's perspective the commands are identical.

## References

- [Vite+ documentation](https://vite.plus)
- [voidzero](https://voidzero.dev)
- [vite-plus on npm](https://www.npmjs.com/package/vite-plus)
- ADR-002 (historical context for the Turborepo choice this ADR supersedes in
  part)
- ADR-013 (the git hook gate that exercises the new `vp`-backed scripts)
