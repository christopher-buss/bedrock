# ADR-013: hk for Git Hook Management with AI-vs-Human Differentiated Gating

**Date:** 2026-04-13 **Status:** Proposed

Decision Makers: Maintainer Tags: developer-workflow, git-hooks, tooling, mise, ci, agentic

## Context

Bedrock's current git hook setup — `simple-git-hooks` + `lint-staged` — runs a
single pre-commit command: install frozen lockfile, then `eslint --fix` on
staged files. That is the entirety of the enforced gate.

CLAUDE.md specifies a "Before Committing" checklist of four commands: lint,
build, test, typecheck. The actual pre-commit hook enforces one of them. The
other three run only if a contributor remembers to run them manually. This gap
is not theoretical: the hook was written at project inception when the monorepo
had almost no code; the gap has grown as the codebase and its test suite have.

Closing this gap with `simple-git-hooks` is technically possible — chain all
four commands in the hook string — but creates a new problem: a heavyweight
pre-commit gate on every human commit. Contributors working in short-cycle TDD
loops would face that cost on every `git commit -m "wip"`. The natural response
is to skip hooks (`--no-verify`), which defeats the purpose entirely.

The project also runs Claude Code as an agentic commit author. When an AI agent
produces a commit, the economics are inverted: the agent does not care about
latency, it has already done the work, and the pre-commit hook is the last
enforcement point before the commit lands in history. Running only lint at that
point is insufficient — it lets the agent produce commits that fail typecheck
or test. A pre-push hook catches those failures but only after the agent has
already committed, requiring a follow-up fixup commit that obscures the
agentic workflow's audit trail.

The forcing function is therefore a **differentiated gate**: comprehensive
checks (typecheck + test + build) must run at pre-commit time for agentic
commits, and at pre-push time for human commits.

`simple-git-hooks` has no primitive for this. It executes a single string per
hook with no conditional logic, no parallelism, and no step-level configuration.
Implementing the differentiated gate on top of it would require a wrapper shell
script that queries the commit author context, branches, and invokes different
commands — a custom hook-manager layer built on top of a minimal tool.

The project already uses [mise](https://mise.jdx.dev/) to manage runtimes
(Bun, Node). **hk** (<https://github.com/jdx/hk>) is a git hook manager by the
same author, installable via mise, with first-class support for parallel step
execution, per-step glob filters, and per-step conditions evaluated as Pkl
expressions. The conditions primitive is the mechanism that makes the
differentiated gate a clean config-level expression rather than an ad-hoc shell
script.

### The differentiated gate in detail

hk's `condition` field on each step takes a Pkl string expression that is
evaluated at hook runtime. A small Node script uses the `std-env` package's
`isAgent` export to detect whether a common AI coding agent is running the
commit:

```ts
import { isAgent } from "std-env";

console.log(isAgent ? "true" : "false");
```

The hk config binds this to a local variable:

```pkl
local isAgent: String = #"exec("node scripts/is-agent.ts") == "true""#
```

Steps that should run only for agentic commits set `condition = isAgent`. Steps
with no condition run for everyone. This is a config-level primitive, not a
shell-branching workaround. The detection logic is maintained by `std-env` as
new agents emerge; bedrock does not own the agent-fingerprinting heuristic.

`std-env` is already in the unjs ecosystem; bedrock uses `c12` (also unjs) for
configuration. Adding `std-env` as a dev dependency is not a new ecosystem
commitment.

### hk technical facts relevant to this decision

- **Config format**: Pkl (Apple's config language). The `hk.pkl` file imports a
  versioned schema from hk's GitHub releases
  (`package://github.com/jdx/hk/releases/download/v1.38.0/hk@1.38.0#/Config.pkl`).
  Pkl is evaluated by hk itself; it is not a runtime dependency of the project.
- **Parallel execution by default**: steps run concurrently unless marked
  `exclusive = true`.
- **Rich hook surface**: pre-commit, pre-push, commit-msg, prepare-commit-msg,
  post-merge, and a `check` hook for manual invocation (e.g. in CI).
- **Installed via mise**: no npm install required; managed alongside existing
  runtimes.

### Turborepo affected runs

Bedrock uses Turborepo. Turbo 2.1+ supports a built-in `--affected` flag
(`turbo run <task> --affected`) that marks a package as affected if any file in
it changed and runs that package's full task graph. The `:affected` pnpm scripts
(`pnpm typecheck:affected`, `pnpm test:affected`, `pnpm build:affected`)
referenced in the hook config do not yet exist; they will be added as part of
this ADR's implementation as thin wrappers over `turbo run <task> --affected`.
No new build tool is introduced.

## Decision

Replace `simple-git-hooks` + `lint-staged` with **hk** for all git hook
management. Implement the following hook layout.

### Common guards (pre-commit, unconditional — all authors)

Run for every commit regardless of author type:

- `no-commit-to-branch` protecting `main`
- `check-merge-conflict` (hk builtin)
- `detect-private-key` (hk builtin)
- `check-added-large-files` (hk builtin, excluding `pnpm-lock.yaml`)

### Pre-commit heavy steps (conditioned on `isAgent` — agentic commits only)

Each step sets `exclusive = true` (cannot run in parallel with each other):

- `typecheck` — glob `*.ts`, `*.tsx` → `pnpm typecheck:affected`
- `test` — glob `*.ts`, `*.tsx` → `pnpm test:affected`
- `build` — glob `*.ts`, `*.tsx` → `pnpm build:affected`

These steps enforce the full CLAUDE.md "Before Committing" gate at commit time
when an AI agent is the author. They do not run for human commits at
pre-commit time.

### Pre-push (unconditional — all authors)

Same three steps (typecheck, test, build) with no condition. Human commits hit
the full gate here, before any push to a remote.

### Additional hooks

- **prepare-commit-msg**: `node scripts/prepare-commit-msg.ts {{commit_msg_file}}`
  (commit message template injection).
- **commit-msg**: `pnpm commitlint --edit {{commit_msg_file}}` — enforces
  Conventional Commits format. `commitlint` (`@commitlint/cli` +
  `@commitlint/config-conventional`) is added as a dev dependency as part of
  this implementation.
- **post-merge**: two conditional steps — if `pnpm-lock.yaml` changed, run
  `pnpm install`; if `mise.toml` changed, run `mise install`.
- **check hook** (manual, for CI): runs all guards plus typecheck + test + build
  unconditionally via `hk check`.

### Config global settings

- `stash = "none"` on pre-commit: no auto-stash of unstaged changes.
- `shell = "bash -c"` on every step: required to prevent hk builtin utilities
  from failing on Windows `cmd.exe`. This is documented as a known limitation
  in Consequences.

### Dependency changes

**Added**:

- `hk` — installed via mise (mise.toml addition; no package.json change)
- `std-env` — npm dev dependency
- `@commitlint/cli` + `@commitlint/config-conventional` — npm dev dependencies

**Removed**:

- `simple-git-hooks` — dev dep removed; `simple-git-hooks` field removed from
  package.json
- `lint-staged` — dev dep removed; `lint-staged` field removed from package.json
  (lint-on-staged-files moves to an unconditional hk pre-commit step)

## Consequences

### Positive

- **The CLAUDE.md gate is enforced for agentic commits.** Typecheck, test, and
  build failures are caught at the moment the agent produces a commit, not after
  the fact. The agent cannot accumulate commits that fail the gate.
- **Human commits are not slowed at pre-commit time.** The heavy checks run on
  pre-push instead. Short-cycle TDD loops remain fast; `--no-verify` is not a
  rational response to the hook latency.
- **Agent detection is maintained externally.** `std-env`'s `isAgent` covers
  Claude Code, Cursor, Aider, and other agents; new agents are picked up as
  `std-env` is updated. Bedrock does not own a fragile agent-fingerprinting
  heuristic.
- **Parallel execution.** Common guards run in parallel by default. Steps that
  must be exclusive are marked; everything else runs concurrently.
- **Mise-ecosystem cohesion.** hk is by the same author as mise; installed and
  versioned via mise alongside Bun and Node. One fewer ecosystem to manage.
- **post-merge automation.** Lock file and runtime manager changes trigger
  installs automatically, preventing the "why isn't my code working after
  merge" class of confusion.
- **commitlint enforces Conventional Commits.** Commit message format is checked
  at commit-msg time, consistent with CLAUDE.md's commit message style
  requirements.
- **`hk check` for CI.** The `check` hook provides a single entry point for
  CI to run the full gate without replicating hook logic in CI config.

### Negative

- **`shell = "bash -c"` required on Windows.** hk builtin utilities fail on
  Windows `cmd.exe` without this setting. This is a workaround for a hk
  limitation; if hk resolves the Windows compatibility issue upstream, the
  setting can be removed.
- **Pkl config format.** hk config is written in Pkl (Apple's config language),
  which most contributors will not have prior experience with. Pkl's syntax is
  learnable but adds onboarding friction compared to YAML-based alternatives.
  The versioned schema import also means config must reference a specific hk
  release version, requiring deliberate updates when upgrading hk.
- **New dev dependencies.** `std-env`, `@commitlint/cli`, and
  `@commitlint/config-conventional` are added. These are dev-only and do not
  affect the zero-runtime-dependencies constraint (ADR-008), but they add
  surface area to the development environment.
- **`:affected` scripts must be added.** `turbo run <task> --affected` wrappers
  do not exist yet. They must be added to package.json as part of this
  implementation. This is low-risk (thin wrappers over Turbo's built-in flag)
  but is a required implementation step before the hooks function correctly.
- **hk is less widely adopted than alternatives.** husky is the dominant
  industry tool; lefthook has significant adoption. hk is newer and primarily
  known in the mise ecosystem. Community resources and third-party integrations
  are less mature.

### Neutral

- **ESLint moves from lint-staged to an unconditional hk pre-commit step.** The
  behavior is equivalent (runs on changed TypeScript files); only the mechanism
  changes.
- **`stash = "none"` means pre-commit hooks see working tree state.** This
  matches the previous behavior with `simple-git-hooks` (which also did not
  stash). No behavior change for existing workflows.
- **Turborepo `--affected` granularity is package-level.** A single-file change
  in a package triggers the full task for that package. This is the same
  granularity as comparable monorepo tools and is a property of Turborepo, not
  an hk concern.

## Alternatives Considered

### Stay on simple-git-hooks + lint-staged

The current tooling, extended with additional commands in the pre-commit string.

**Rejected.** Cannot express the AI-vs-human differentiated gate without a
custom wrapper script that effectively reimplements a hook manager on top of
`simple-git-hooks`. Cannot run steps in parallel. The comprehensive CLAUDE.md
gate as a flat serial command would impose noticeable pre-commit latency for
all authors, incentivizing `--no-verify` use.

### husky

Industry-standard hook manager with broad adoption and extensive
community resources. Script-per-hook model — each hook is a shell script
committed to `.husky/`.

**Rejected.** Viable for a same-for-everyone comprehensive gate. Does not have
a first-class primitive for author-type-conditional steps; the differentiated
gate would be expressed as ad-hoc shell branching inside each hook script (e.g.,
`if node scripts/is-agent.ts; then ...; fi`). This works but is a
shell-branching workaround rather than a config-level primitive. No mise-native
integration. The author has prior experience with husky; the rejection is not a
capability gap for same-for-everyone gating, but a weaker story on the two
differentiating criteria (mise ecosystem cohesion; config-level agent detection).

### lefthook

Fast, parallel, single-YAML-config hook manager. Supports glob filters and
parallel step groups natively.

**Rejected.** Same limitation as husky on author-type differentiation — would
require shell-level branching rather than a config-level condition primitive.
No mise-native story (installed via npm or system package manager, separate from
mise's toolchain). YAML config is more familiar than Pkl but provides fewer
expression primitives. Lefthook is otherwise technically viable for a
same-for-everyone gate.

### pre-commit (pre-commit.com)

Python-ecosystem hook framework with a large repository of managed hook
definitions.

**Rejected.** Python runtime mismatch with the project (Bun/Node managed via
mise). Requires Python environment setup that the project does not otherwise
need. The managed hook repository is valuable for general-purpose repos but
adds no benefit here — bedrock's hooks are project-specific commands, not
community hook definitions.

## Implementation Notes

- **Add `:affected` scripts to root `package.json`**: `"typecheck:affected":
  "turbo run typecheck --affected"`, `"test:affected": "turbo run test
  --affected"`, `"build:affected": "turbo run build --affected"`.
- **Add `hk` to `mise.toml`** under `[tools]`. Pin to the version whose schema
  is referenced in `hk.pkl`.
- **Add `is-agent.ts` script** at `scripts/is-agent.ts` importing `std-env`'s
  `isAgent` and printing `"true"` or `"false"` to stdout.
- **Remove `simple-git-hooks` and `lint-staged`** from `package.json` devDependencies
  and remove the `simple-git-hooks` and `lint-staged` configuration fields.
- **Add commitlint config** (`commitlint.config.ts` or equivalent) extending
  `@commitlint/config-conventional`.
- **Register hooks** via hk's install command (exact invocation to be confirmed
  against current hk documentation) so `.git/hooks/` is wired to the
  `hk.pkl` config. This replaces the `simple-git-hooks` postinstall step.
- The `check` hook is the recommended CI entry point: `hk check` in the CI
  workflow replaces any current hook-simulation logic.
- ADR-006 (ADR enforcement) requires this ADR to be accepted before
  implementation begins. The dependency changes listed above should be grouped
  in a single commit with the `hk.pkl` config, with this ADR referenced in the
  commit message.

## Related Decisions

- **ADR-002**: Monorepo with Turborepo and FCIS + Ports Architecture — the
  `:affected` scripts added here are wrappers over `turbo run <task> --affected`,
  using the Turborepo build tool ADR-002 established.
- **ADR-003**: Testing Strategy — the `test:affected` step enforces ADR-003's
  coverage requirements at commit time for agentic commits and at push time for
  human commits.
- **ADR-006**: ADR Enforcement — this ADR is required before implementing the
  hook changes. The gap between CLAUDE.md's "Before Committing" documentation
  and the actual hook enforcement is the forcing function this ADR addresses.
- **ADR-008**: Zero Runtime Dependencies in `@bedrock/open-cloud` — the new dev
  dependencies (`std-env`, commitlint) are development tooling, not runtime
  dependencies of any published package. ADR-008's constraint is not affected.

## References

- [hk repository](https://github.com/jdx/hk)
- [hk documentation](https://hk.jdx.dev/)
- [std-env](https://github.com/unjs/std-env)
- [mise](https://mise.jdx.dev/)
- [Turborepo --affected flag](https://turborepo.com/docs/reference/run#--affected)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [@commitlint/config-conventional](https://github.com/conventional-changelog/commitlint/tree/master/%40commitlint/config-conventional)
