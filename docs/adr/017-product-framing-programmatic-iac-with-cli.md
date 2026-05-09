# ADR-017: Product Framing -- Programmatic IaC with CLI Convenience (Level 2 Hybrid)

**Date:** 2026-04-17  **Status:** Accepted

Decision Makers: Maintainer  
Tags: product, api-design, public-api, cli, plugin-system, semver

## Context

Bedrock started as a CLI tool. Its early ADRs (002, 011) reflect that framing:
FCIS + Ports was justified on "CLI tool, not business domain" grounds; the
hexagonal architecture was rejected as ceremony not warranted for a CLI. That
framing is now incomplete.

Bedrock serves two distinct audiences:

- **Standard Luau developers** -- the majority of the Roblox developer
  population. They write game code in Luau. They configure tooling via YAML,
  JSON, or minimal JS/TS data files. The CLI + multi-format config (c12) is
  their primary surface. This is why multi-format config exists: it is full,
  deliberate support for users who have no interest in TypeScript embedding.
- **roblox-ts developers** -- a minority who write game code in TypeScript.
  They have everything the Luau audience has, plus the ability to import Bedrock
  as a TypeScript library and call its functions directly from scripts, tests,
  and CI pipelines.

The stakes differ by audience. The Luau audience's deployment experience is
already well-served by CLI + multi-format config; nothing described here
changes that. The roblox-ts audience's experience is what's at stake: when a
roblox-ts developer needs to automate deployment -- scheduled price changes,
post-deploy Luau constant generation, drift assertions in CI -- the natural
move is to import Bedrock as a library, not to shell out to its CLI. If that
programmatic surface is an afterthought (undocumented internals, no stability
commitment, no examples), the roblox-ts use cases are effectively locked out.

The planned plugin system (v0.3+) makes the stakes concrete: plugins
will implement `ResourceDriver<K>` and call core functions like `diff` and
`applyOps`. That plugin contract *is* a public API. Treating it as an escape
hatch rather than a documented, stable product surface would mean shipping an
extensibility story on an undocumented, unstable foundation.

Three product framings were available:

- **Level 1** (CLI-first with escape hatch): `bedrock.config.ts` is a data file;
  `bedrock deploy` is the entry point; programmatic use is an advanced escape
  hatch, lightly documented if documented at all.
- **Level 2** (programmatic-first with CLI convenience): Bedrock is a TypeScript
  library. CLI commands are thin wrappers over the same public functions.
  Programmatic use is equally documented, equally stable, and equally supported.
- **Level 3** (constructor-registration, Pulumi/CDK style): `new GamePass(...)`
  registers resources with an engine at construction time.

## Decision

Bedrock is a **programmatic TypeScript IaC library for Roblox. The CLI is a
convenience wrapper over the same public API. User scripts that import Bedrock
are a canonical way to use it, not a side door (Level 2).**

Concretely:

- Users may write a `deploy.ts` that calls `deploy()`, `diff()`, or `applyOps()`
  directly and run it with `bun run deploy.ts`. This is not an escape hatch --
  it is the canonical programmatic surface.
- `bedrock deploy` loads a default-exported config and calls the same underlying
  functions. CLI and programmatic paths are identical below the entry point.
- The following surface is the **public API**: `diff`, `applyOps`, `buildDesired`,
  `ResourceDriver<K>`, `defineConfig`, `deploy`, all associated type contracts,
  and any symbol exported from `src/index.ts`.
- The public API is semver-versioned. During 0.x, breaking changes are permitted
  in minor bumps (0.1 -> 0.2) per standard pre-1.0 semver convention. Strict
  breaking-change-in-major-only semantics engage at 1.0.
- Every public export carries a JSDoc `@example` block per ADR-005. No public
  symbol ships without a tested, rendered example.
- The TypeDoc docs site (ADR-004) publishes both CLI and programmatic API
  documentation at v0.1 launch. There is no "API coming soon" placeholder.
- `ResourceDriver<K>` is a plugin contract, not an internal type. Third-party
  authors will implement it. Its stability follows the same semver treatment as
  the rest of the public API.

### Motivating use cases

These use cases drove Level 2 from the roblox-ts audience. The Luau audience
is served equivalently by multi-format config (YAML/JSON) + CLI; Level 2 does
not change their experience.

1. **Scheduled price mutations.** A cron-triggered script bypasses the `bedrock`
   CLI entirely and runs as a plain TypeScript program (e.g.
   `bun run scripts/black-friday.ts`). The script imports Bedrock's functions
   directly -- `loadConfig`, `deploy` -- and orchestrates the full
   mutate-then-deploy flow in user code: load the config, override game-pass
   prices to 30% off, call `deploy()`. A second cron later restores normal
   prices. This is meaningfully different from `bedrock deploy`, which loads the
   default config and deploys it unmodified. The programmatic API makes the
   "mutate then deploy" flow possible in a single process; the CLI alone cannot
   express it.
2. **Post-deploy output plugins.** After a deploy completes, a user-authored
   plugin writes Luau source files (e.g. `Passes.luau` with game-pass asset IDs
   as constants) for use in game code. The plugin receives the deployed state as
   data and writes whatever output the studio needs. Different studios have
   different output shapes; the plugin system exists to support this without
   Bedrock prescribing the format.
3. **Drift assertions in CI.** A test file imports `diff` from Bedrock and calls
   it against live Roblox state. If the result is non-empty, the test fails --
   config and live state have diverged without a deploy. This gives studios an
   automated early-warning signal that runs in CI without any CLI invocation.
4. **Multi-game monorepo orchestration.** A studio with multiple Roblox
   experiences writes a single script that iterates over per-game configs and
   calls `deploy()` for each. Sequencing, error handling, and reporting are
   expressed in TypeScript; the script does not shell out to `bedrock deploy`
   in a loop.

## Consequences

### Positive

- Plugin system (v0.3) has a stable, documented foundation to build on.
  `ResourceDriver<K>` is ready to be implemented by third parties before the
  plugin runtime ships.
- Programmatic use cases (scheduled scripts, drift tests, orchestration) are
  supported without workarounds.
- TypeScript users get full type inference and IDE support for deployment logic.
  `defineConfig` returns a typed value; `diff` and `applyOps` have documented
  signatures.
- The CLI and programmatic surfaces cannot diverge: they share the same
  underlying functions.
- ADR-005's `@example` requirement applies to the entire public API, so the docs
  site renders complete, tested usage samples at launch.

### Negative

- Public API = product. Every exported symbol in `src/index.ts` is a commitment.
  Thoughtless exports accumulate semver debt. Contributors must apply the same
  discipline to API surface that ADR-003 requires for tests.
- Function signatures must be ergonomic for embedding: named parameter objects,
  sensible defaults, TS inference. This is additional design work on top of
  making functions correct.
- Integration tests are needed to verify the public API works end-to-end, not
  just that internal units behave correctly. Test surface grows.
- Semver creates a communication obligation: breaking changes to the public API
  during 0.x require a CHANGELOG entry with clear labeling. No deprecation
  notice period is required during 0.x; no release cadence is mandated. Both
  are deferred to a future 1.0 stability policy ADR.
- The Open Cloud constraint (ADR-007) applies to Bedrock's own adapters.
  Third-party plugin authors are responsible for their own API choices within
  their `ResourceDriver<K>` implementations.

### Neutral

- Package structure (single `bedrock` package vs. split `@bedrock-rbx/core` +
  `@bedrock-rbx/cli`) is not resolved by this ADR. Splitting is deferred until
  concrete demand arises. A future ADR will define the split criteria if needed.
- ADR-002's FCIS + Ports architecture is unaffected by this decision. Level 2
  is a product framing, not an architecture-pattern change. ADR-018 (planned)
  will refine ADR-002 to reflect the primary/driven port distinction that Level
  2 makes explicit.

### Revisit criteria

This ADR should be reopened if any of the following occur:

- **Package split demand emerges.** Concrete pressure -- bundle-size complaints,
  versioning divergence between core and CLI, or an external embedder explicitly
  requesting a standalone `@bedrock-rbx/core` -- upgrades the package-structure
  question from "neutral/deferred" to an active decision.
- **1.0 planning begins.** The semver obligations deferred here (deprecation
  notice period, release cadence) must be decided before strict
  breaking-change-in-major semantics engage. A 1.0 stability policy ADR should
  supersede the deferred items in this one.
- **Audience ratio shifts substantially.** If roblox-ts adoption grows to the
  point where it is no longer a clear minority of Bedrock users, the two-audience
  framing and the "Level 2 does not change the Luau audience's experience"
  language may need rebalancing.
- **Level 3 ergonomic complaints are resolved by new patterns.** If CDK/Pulumi
  successors demonstrably solve implicit ordering, constructor side-effects, and
  difficult unit testing -- the four objections listed under Level 3 rejection --
  the constructor-registration alternative should be re-evaluated.

## Alternatives Considered

### Level 1: CLI-first with programmatic escape hatch

`bedrock.config.ts` is a data file. `bedrock deploy` is the primary entry point.
Programmatic access exists but is undocumented, unstable, and framed as
advanced use.

**Rejected.** Level 1 leaves the plugin system without a supported foundation:
plugins implement `ResourceDriver<K>` and call core functions like `diff` and
`applyOps`, which Level 1 explicitly treats as undocumented, unstable, advanced
use. The plugin system's stability becomes an accidental consequence of the
escape hatch's quality rather than a designed commitment. Beyond plugins, the
motivating use cases above are mainstream roblox-ts studio workflows -- not edge
cases. Level 1 makes them harder, not easier, while providing no concrete
benefit.

### Level 3: Constructor-registration (Pulumi / CDK style)

`new GamePass({ name: "VIP" })` registers the resource with a global engine at
construction time. `bedrock.deploy()` flushes the registry.

**Rejected** for four specific reasons:

1. **Machinery cost disproportionate to scope.** v1.0 has six resource types.
   The registration runtime, lifecycle hooks, and dependency graph that
   constructor-based tools require are significant engineering investment for
   a small fixed resource set.
2. **Mantle migration becomes hard.** YAML config maps naturally to a
   `defineConfig` data structure. It does not map naturally to constructor calls.
   Maintaining the migration path (CLAUDE.md constraint) requires config-as-data.
3. **Known ergonomic complaints.** AWS CDK Level-3 constructs carry
   widely-documented friction: implicit ordering, constructor side-effects,
   difficult unit testing, surprises when constructs are composed. Bedrock should
   not import these problems.
4. **Config-as-data matches both audiences.** Luau developers are already
   familiar with declarative config files (Mantle YAML, Rojo `project.json`);
   a `defineConfig` data structure is a natural continuation of that idiom.
   roblox-ts developers are familiar with typed object literals and Vite-style
   `defineConfig` helpers; the data-file pattern is equally comfortable for
   them. Constructor-registration is a larger conceptual step for both groups
   and benefits neither.

## Implementation Notes

- API surface is gated at `src/index.ts`. Symbols not exported there are
  internal and carry no stability commitment.
- `defineConfig` should return its argument typed, so TypeScript infers the
  config shape without requiring explicit type annotations at call sites.
- `ResourceDriver<K>` documentation must include a full `@example` implementing
  a minimal driver, so plugin authors have a concrete starting point.
- The docs site must present CLI-with-multi-format-config and programmatic-TS
  as peer entry points, not a hierarchy. Luau users land on CLI + YAML/JSON
  config; roblox-ts users land on either surface. Neither path is buried or
  framed as advanced.
- ADR-018 (planned) refines ADR-002 to name the primary port (CLI entry,
  programmatic entry) vs. driven ports (state backend, Open Cloud HTTP). That
  distinction follows from Level 2 but is a separate architectural concern.

## Related Decisions

- **ADR-002**: Monorepo with FCIS + Ports Architecture -- unaffected by this
  ADR. Level 2 is a product framing; the internal architecture remains FCIS +
  Ports. Planned ADR-018 will refine ADR-002 on primary/driven port distinction.
- **ADR-004**: Documentation Site -- the docs site must publish both CLI and
  programmatic API documentation at v0.1. ADR-004's v0.1 deliverable scope is
  extended by this decision.
- **ADR-005**: Tested JSDoc Examples -- `@example` blocks are required on every
  public export, not just selected ones. ADR-005's scope is broadened to the
  full `src/index.ts` surface by this decision.
- **ADR-007**: Open Cloud APIs Only -- unaffected. The constraint applies to
  Bedrock's own adapters. Third-party plugin authors are not bound by it.
- **ADR-009**: Result Types Over Exceptions -- public API functions follow the
  same `Promise<Result<T, E>>` convention established for `@bedrock-rbx/ocale`.
- **ADR-011**: Simplified Architecture for Library Packages -- the five-criteria
  opt-out check applies if a future `@bedrock-rbx/core` split is proposed. The CLI
  package (which contains deployment logic) continues to fail criteria 2, 3, 4,
  and 5 and must use FCIS + Ports.

## References

- [Mantle](https://github.com/blake-mealey/mantle) -- predecessor; migration
  path is a CLAUDE.md hard constraint
- [Pulumi](https://www.pulumi.com/) -- Level 3 reference; ergonomic complaints
  informed the rejection
- [AWS CDK Level-3 Constructs](https://docs.aws.amazon.com/cdk/v2/guide/constructs.html) --
  Level 3 reference; documented friction informed the rejection
- ADR-004, ADR-005 -- documentation and example obligations extended by this ADR
