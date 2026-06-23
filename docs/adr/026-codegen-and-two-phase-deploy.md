# ADR-026: Codegen and Two-Phase Deploy

**Date:** 2026-06-22 **Status:** Accepted

Decision Makers: Maintainer
Tags: deploy, codegen, state, data-model, ports, two-phase, core

## Context

Game code needs to reference Roblox-assigned asset IDs (game-pass IDs,
developer-product IDs, icon asset IDs) by a stable **Key** rather than a
hardcoded number. Today those IDs only exist in **State** after a deploy
provisions them, and consuming them is left entirely to the user
(Mantle parity). Issue #119 asks bedrock to optionally generate source files
from deployed **Outputs**. ADR-017 already named "post-deploy Luau constant
generation" as a motivating use case for the programmatic surface.

A harder, related problem sits on top of codegen. A place's `rbxm` is built
*before* deploy, but a deploy may `create` a provisioned asset and mint a *new*
ID the build needed to embed. The pre-built artifact therefore cannot contain
an ID that did not exist when it was built. The common workaround generates
asset source *after* deploy and commits it back (often via a CI bot), so the new
ID only reaches the game on a *second* deploy. The two-deploy lag and the
load-bearing commit step are the pain this ADR removes.

Key constraints shaping the design:

- bedrock is FCIS + Ports (ADR-018). The engine performs no I/O it was not
  handed; running a user's build is arbitrary I/O.
- A place is an opaque artifact to bedrock. The engine cannot inspect an `rbxm`
  to learn which assets it references; its only signals are **Operation**-level
  (`create` mints a new ID, `update`/`noop` do not), and there are no
  inter-resource edges in the diff algebra (ADR-019).
- Config is validated data loaded multi-format via c12 (TS/JS/YAML/JSON/Luau).
  Functions cannot live in it.
- Provisioned `create` (game-pass / developer-product POST) is **not**
  idempotent — a retry mints a duplicate.
- `applyOps` is parallel and continue-on-failure with a fixed internal apply
  ordering — universe first, then the rest concurrently (ADR-023). A batch can
  therefore succeed partially, returning an `AggregateApplyError` of survivors
  plus failures. `applyOps` dispatches only non-`noop` ops.
- A `statePort.write` can itself fail after remote creates succeed; ADR-023
  defines the resulting orphan-recovery contract (`stateWriteFailed.unsavedState`).
- The common Roblox shape is one artifact serving several environments, with
  IDs resolved at runtime; codegen for it must see *all* environments' state.

To avoid colliding with ADR-023's apply-level "Phase 1 / Phase 2" (universe vs.
the rest), this ADR names its two halves the **asset stage** and the
**republish stage**.

## Decision

### Codegen (opt-in, issue #119 proper)

A three-tier opt-in ladder: (1) no codegen — IDs live only in **State**;
(2) **Codegen** — emit **Outputs** to source files; (3) **Two-phase deploy** —
rebuild and republish a place on top.

When enabled, codegen runs after the asset stage on every deploy. The
customizable unit is the **Emitter**: a layered API where declarative
`{ path, language }` yields a working file with no code, and an optional `emit`
override takes full control of layout. `emit` receives the current state of
**all declared environments** and returns a list of file descriptors to write,
each carrying an output `path` and its contents; bedrock writes them. bedrock never commits — the generated file is regenerable from **State**
and is not on the deploy's critical path.

**Cross-environment read.** The environment list comes from `config.environments`.
`deploy` reads each environment's snapshot via `statePort.read(env)` — fresh for
the environment being deployed (the in-flight result), last-known for the rest.
An environment that has never deployed reads `undefined` and is presented to the
emitter as having no resources; the emitter decides whether to omit it or emit a
placeholder. This assumes one backend credential can read every environment's
state (true for the gist backend); a backend that partitions credentials per
environment would surface only the environments it can read.

**Partial asset failure.** Because the asset stage is continue-on-failure,
codegen emits source only for keys that resolved to real IDs and omits keys
whose `create` failed (derived from `AggregateApplyError.failures`). No
half-resolved ID reaches a build.

The default emitter targets **Luau** (universal across Roblox projects), with an
opt-in `.d.ts` companion so roblox-ts consumers get type-safety over the same
Luau module without a parallel TypeScript emitter. Generated-file location and
its relationship to ADR-025's managed `.bedrock/` directory and `@bedrock` alias
are settled at implementation time; the default path is user-configurable.

### Two-phase deploy

Activates iff a **Rebuild hook** is supplied **and** either the diff contains a
provisioned `create` **or** any place carries a `pendingRebuild` marker. Trigger
is "any provisioned create," not declared per-resource dependencies: bedrock has
no inter-resource edges and a stray rebuild is cheap, whereas a dependency graph
is new state surface that goes stale. Because there are no edges, the marker is
set for **all** places in the deploy, not a computed subset.

A two-phase deploy splits the single apply into two:

1. **Asset stage** — `applyOps` runs with place ops withheld (universe and
   provisioned assets only, keeping ADR-023's internal universe-first ordering).
   New IDs are minted here.
2. **Checkpoint write** — persist asset outputs and set the `pendingRebuild`
   marker, before the rebuild can fail.
3. **Codegen** — write the generated file(s) from current state.
4. **Rebuild hook** — invoked (wrapped; a throw does not abort the checkpointed
   state). Returns an array of per-place entries, each carrying the place
   **Key** and its rebuilt artifact.
5. **Republish stage** — a second `applyOps` over the place ops, using the
   returned artifact bytes as desired input. A place under `pendingRebuild` whose
   diff was `noop` is republished via a **synthesized `update` op** injected by
   `deploy` (its `changedFields` records the forced rebuild), since `applyOps`
   never dispatches `noop`s.
6. **Final write** — clear the marker for every place the hook actually
   republished and persist place versions.

The **Rebuild hook** is one callback per deploy, receiving post-asset-stage
state and returning an array of per-place entries, each carrying the place
**Key** and its rebuilt artifact. bedrock owns the
orchestration; the hook owns the build. bedrock does not know how to build.

### Failure and convergence

bedrock keeps its existing non-transactional model — there is no all-or-revert.
Two rules make two-phase safe:

1. **Checkpoint before the risky step.** Asset outputs are persisted *before*
   the rebuild can fail, narrowing the window for duplicate provisioning. It does
   not close it: if the checkpoint write itself fails, freshly-minted
   non-idempotent IDs are unpersisted and a retry re-creates them — the same
   orphan window ADR-023 documents, recovered the same way
   (`stateWriteFailed.unsavedState`).
2. **`pendingRebuild` marker for self-healing.** A checkpointed `create` `noop`s
   on the next run, so the create trigger alone cannot re-fire — a recovered
   build would otherwise leave a green-but-stale place. The marker, set at
   checkpoint and cleared per-place on successful republish, re-activates
   two-phase on retry.

Marker lifecycle: `absent → set at checkpoint → present across codegen +
rebuild → cleared at final write for each republished place`. On a failed
rebuild or republish the marker stays set and the deploy returns an error.

**Marker present but no rebuild hook** (e.g. a CLI run against a YAML config
after a hooked run failed) is a **hard error**: the deploy refuses to report
success while a rebuild is owed and cannot be performed. An escape hatch clears
the marker for a user deliberately abandoning two-phase.

**Partial asset failure** aborts the rebuild: survivors and the marker are
persisted, codegen emits only resolved keys, and the deploy returns an error;
the next run retries via the marker rather than building against missing IDs.

### State contract

`pendingRebuild` is bedrock bookkeeping — neither user-declared desired state
nor Roblox-returned **Outputs**. It is stored as a **list of resource keys in
the file-level `$bedrock` envelope** (`{ $bedrock: { version, pendingRebuild } }`),
preserving ADR-019's invariant that the `$bedrock` key is **adapter-private**:
adapters map it to and from a typed, core-visible `BedrockState.pendingRebuild`
field, exactly as they already flatten/re-wrap `version`. `ResourceCurrentState`
is unchanged — no per-resource key, no public per-resource type change. The
marker is **presence-only** (a key is listed or absent, never a `false`); a
clean republish removes the key from the list, and the on-disk list is omitted
when empty so a happy-path state never shows it.

This is a v1-compatible, optional envelope addition: the existing envelope schema
ignores unknown `$bedrock` members, so a pre-ADR-026 reader tolerates the field
(and, not knowing two-phase, simply drops it on its next write — harmless, since
that binary performs no rebuilds). `serializeStateFile`/`parseStateFile` own the
`BedrockState.pendingRebuild` ↔ envelope mapping; `mergeResources` is unaffected
because the marker no longer rides on resource entries. The marker never
participates in **Drift** — it is not a resource field.

### Surface

Function hooks (`emit`, `rebuild`) are supplied through `DeployOptions`
(programmatic), with optional pickup from a TS/JS config module so the CLI can
use them. Declarative codegen knobs live in `Config`. Two-phase and custom
emitters are therefore **TS/JS only**; YAML/JSON/Luau configs get the default
emitter and no rebuild. This is inherent — a build is arbitrary code.

Surfacing icon asset IDs in codegen is free (they are already in game-pass
**Outputs** and the emitter sees full state). Codegen emits the real minted ID
for a redacted resource (ADR-024); redaction hides content, not identity. A
generic image-upload resource kind is out of scope and deferred.

## Considered Options

- **Bedrock exposes primitives; a wrapper orchestrates.** Rejected for the
  default path: the single smart `deploy` call is the DX goal. Primitives may
  still be exposed underneath as an escape hatch.
- **Bedrock embeds the build.** Rejected: makes `deploy` non-deterministic and
  couples the engine to a build toolchain. The injected hook keeps I/O at the
  edge.
- **Declared per-resource dependencies for the trigger.** Rejected for v1: new
  config surface and the first inter-resource edge in an edge-free diff engine,
  to avoid a cheap, harmless extra rebuild.
- **Resource-level `$bedrock` for the marker.** Rejected: contradicts ADR-019's
  adapter-private invariant, forces a public `ResourceCurrentState` type change,
  and (because `serializeStateFile` rebuilds the envelope from typed resources)
  would silently drop the marker on every write. The envelope-list form avoids
  all three.
- **Force-flag recovery instead of a marker.** Rejected: a recovered build
  silently reports success over a stale place.
- **Last-codegen-hash fingerprint instead of a key list.** Deferred: more
  precise (catches icon-only changes) but more state surface than needed to
  prove the flow; noted as the eventual direction.
- **Splitting codegen and two-phase into separate ADRs.** Rejected: the
  dependency is one-directional (two-phase needs codegen; codegen stands alone),
  but the state-contract and port additions only make sense alongside the
  orchestration that motivates them, so they are recorded together.

## Consequences

- `BedrockState` gains an optional, typed `pendingRebuild` field; the on-disk
  `$bedrock` envelope gains a `pendingRebuild` list. `serializeStateFile` and
  `parseStateFile` own the mapping; `ResourceCurrentState` and `mergeResources`
  are untouched. v1-compatible.
- Deploys now perform an intermediate checkpoint `statePort.write` mid-reconcile,
  so the `stateWriteFailed.unsavedState` contract (ADR-023) applies to two writes.
- A two-phase deploy invokes `applyOps` twice (asset stage, then republish
  stage) and `deploy` may synthesize an `update` op for a forced republish.
- Codegen reads every declared environment's state once per deploy where codegen
  is enabled.
- A new driven concept (the **Emitter**) and a new injected callback (the
  **Rebuild hook**) join the port surface.
- Two-phase is unavailable to non-TS/JS configs by construction.
- Hand-rolled post-deploy generators and commit bots become removable: codegen +
  the rebuild hook make a single deploy self-contained.

## Implementation Notes

### Default emitter and output path (2026-06-23)

The Decision deferred the generated-file location and its relationship to
ADR-025's `.bedrock/` directory "to implementation time." Settled:

- The default emitter (`createDefaultEmitter`) writes `resources.luau`: a Luau
  module of deployed outputs keyed by environment name, then resource **Key**,
  then that resource's **Outputs**. Roblox asset IDs are emitted as Luau number
  literals. It is exported so a custom `emit` can wrap rather than replace it.
- Opting in via `codegen.typeDeclarations: true` (or
  `createDefaultEmitter({ typeDeclarations: true })`) additionally writes a
  `resources.d.ts` companion (`export =`) so roblox-ts consumers type the same
  module.
- The default output directory is `.bedrock/generated` (overridable via
  `codegen.output`), a `generated/` subdirectory of ADR-025's managed
  `.bedrock/` directory so codegen output stays clear of the
  `bedrock setup`-managed type files. With the `@bedrock` directory alias, the
  module is consumed as `require("@bedrock/generated/resources")`. Because the
  default emitter needs no `emit` override, enabling codegen with no further
  configuration now always produces a file, so the prior `codegenOutputMissing`
  deploy error is removed.

- ADR-017 (programmatic IaC + CLI) — names post-deploy constant generation; the
  hooks live on the programmatic surface.
- ADR-018 (FCIS + primary/driven ports) — the rebuild hook and emitter are
  injected, keeping I/O at the edge.
- ADR-019 (state data model & diff algebra) — the `$bedrock` envelope, the
  adapter-private invariant, and the diff algebra this marker stays out of.
- ADR-021 (file-backed resource kinds) — places publish by file hash; the
  republish stage feeds rebuilt bytes through the same path.
- ADR-023 (apply semantics) — phase ordering, continue-on-failure aggregate
  outcome, and the orphan-recovery contract the checkpoint inherits.
- ADR-024 (redaction) — codegen emits real IDs for redacted resources, and
  (per ADR-024's 2026-06-23 amendment) the real pre-redaction display values
  too: the emitter sees each redactable field as `Field<T> = T | { value,
  redacted }` via `codegenView`, narrowed with `realValue` / `pushedValue` /
  `isRedacted`. Identity (asset IDs) and now display content both reach the
  game; only the placeholders ship to Open Cloud.
- ADR-025 (Luau type definitions) — the default Luau emitter and `.d.ts`
  companion relate to the Luau distribution story.

## Amendment -- 2026-06-23 (real display values for emitters)

Redaction (ADR-024) persists the *pushed* placeholder display values, so an
emitter reading **State** could not recover the real name, price, or
description of a redacted resource — only its (never-redacted) asset IDs. The
real values are now persisted in a diff-ignored `$realDisplay` sibling in the
state file (ADR-024 / ADR-019 2026-06-23 amendments) and surfaced to the
emitter through a co-located per-field view: `codegenView(resource,
realDisplay)` widens each redactable field to `Field<T> = T | { value,
redacted }`, with exported `realValue` / `pushedValue` / `isRedacted` helpers so
emitters never hand-narrow the union. The diff path is unchanged and stays
redaction-blind. The contract is verifiable end-to-end through the `deploy()`
seam with in-memory fakes (no real disk or network).

## Amendment -- 2026-06-23 (codegen-content fingerprint supersedes the create-only trigger)

The original two-phase trigger (user story 14) rebuilt a place only when the
diff contained a provisioned `create`. That misses a project that embeds
*mutable* fields (a price, a name) into the place rather than just IDs: a
price/name `update` is not a `create`, so the pre-built artifact and the
regenerated source silently diverged until the next provisioning. The
"last-codegen-hash fingerprint" recorded as deferred in *Considered Options* is
now adopted, retiring the create-only trigger.

**What changes.** The rebuild decision moves to **after** codegen. Once codegen
emits, bedrock hashes the emitted output (`Sha256Hex`) and rebuilds + republishes
iff that hash differs from a stored fingerprint **or** a `pendingRebuild` marker
is set; otherwise it publishes the pre-built file. A provisioned `create` changes
the emitted output, so its hash differs: the create trigger is **subsumed and
retired**, not duplicated. Because the decision now needs the emitted hash,
whenever a rebuild hook **and** active codegen are both present the deploy always
defers place ops past the asset stage: the asset stage mints IDs and persists
mutable asset fields, codegen regenerates source, then the hash check picks
republish-rebuilt-bytes vs publish-pre-built-file per place.

**State.** A single global `codegenHash` is persisted in the adapter-private
`$bedrock` envelope alongside `pendingRebuild`, diff-ignored (ADR-019 2026-06-23
amendment). Lifecycle: the new hash is stored only on the write that completes a
**successful** publish/republish; on a failed rebuild or republish the stored
hash stays stale and the marker stays set, so the next deploy self-heals: the
same convergence guarantee the marker already provided, now also covering
mutable-field drift. A clean first deploy has no stored hash, which reads as
"differs" and rebuilds.

**Trigger now requires codegen.** Two-phase activates only when a rebuild hook is
supplied **and** codegen is active (or a leftover marker forces a retry). Without
codegen there is no generated source to fingerprint, so the rebuild hook is inert
and the deploy publishes the pre-built file in a single pass. This is the
intended coupling: tier 3 (two-phase) sits on tier 2 (codegen) in the opt-in
ladder, and a rebuild only has meaning as "recompile against the source codegen
just rewrote."

**Operational consequence.** Because the rebuild recompiles *after* codegen
rewrites source, the deploy environment now needs the build toolchain, not just a
pre-built artifact. A CI job that previously shipped only the `rbxl` must also be
able to run the project's build.

The flow stays verifiable end-to-end through the `deploy()` seam with in-memory
fakes: `deploy.spec` covers the single-pass, fingerprint-rebuild (price/name
update), create-rebuild, no-op-publishes-pre-built, partial-asset-failure, and
retry-via-marker paths.
