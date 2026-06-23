# Bedrock Core

`@bedrock-rbx/core` is the IaC engine that reconciles user-declared desired state against live Roblox state via `@bedrock-rbx/ocale`, persisting per-environment snapshots between deploys. This context covers the vocabulary used to describe what bedrock manages, how reconciliation is structured, and the plugin contracts that let third parties extend the engine.

## Language

### Resources

**Resource**:
A single instance of a managed Roblox entity that bedrock reconciles between declared desired state and live state (e.g. a specific game pass keyed `"vip-pass"`, a specific place keyed `"start-place"`, the singleton universe keyed `"main"`).
_Avoid_: entity, item, thing

**Kind**:
The discriminator tag identifying which type of Roblox entity a **Resource** represents (`"gamePass"`, `"place"`, `"universe"`, `"developerProduct"`). Surfaced in code as the `ResourceKind` type.
_Avoid_: type, category, sort

**Key**:
Stable identifier for a **Resource** within a config (e.g. `"vip-pass"`), user-supplied for most kinds and synthesized for the universe singleton (`"main"`); carried across deploys so desired and current state can correlate even when Roblox-assigned IDs are unknown. Surfaced in code as the branded `ResourceKey` type.
_Avoid_: id, name, slug, handle

### State

**Desired state**:
What a user declares in config for one **Resource**: the shape bedrock converges toward. Produced by `buildDesired` from flattened inputs after normalization (file reads, SHA-256 hashing).
_Avoid_: target state, spec, intent

**Current state**:
A **Resource**'s last-known shape as persisted in the **State** file after the most recent reconcile: structurally **Desired state** plus a nested **Outputs** block. Trusted on the next reconcile rather than re-fetched from Roblox.
_Avoid_: actual state, observed state, live state

**Outputs**:
The Roblox-assigned identifiers a driver returns after creating or updating a **Resource** upstream (asset IDs, version numbers, root place IDs). Nested under each **Current state** entry; absent from **Desired state** because the user does not supply them.
_Avoid_: ids, results, server-assigned fields

**State**:
The per-**Environment** snapshot bedrock persists between deploys: a versioned `BedrockState` carrying the list of **Current state** entries for that **Environment**. Read at the start of each **Deploy**, written at the end.
_Avoid_: save, history

**Environment**:
The partition unit for both **State** (each environment has its own persisted record) and config (per-environment overlays merged onto root). User-supplied name (e.g. `"production"`, `"staging"`); validated against an env-name regex.
_Avoid_: stage, target, workspace

### Reconciliation

**Operation**:
A single reconciliation step produced by **Diff** and consumed by **Apply**: `create` (a **Resource** declared in desired but absent from current), `update` (a **Resource** present on both sides whose declared fields differ), or `noop` (a **Resource** already reconciled). There is no `delete` variant; **Current state** entries without a matching **Desired state** are ignored.
_Avoid_: action, step, command, change

**Diff**:
The pure function from a list of **Desired state** entries and a list of **Current state** entries to a sequence of **Operations**. Synchronous, no I/O.
_Avoid_: plan, reconciliation plan

**Apply**:
The shell step that dispatches each non-noop **Operation** to its matching **Driver** and collects the resulting **Outputs** into an updated **Current state** list: universe ops first, then everything else in parallel with continue-on-failure. Implemented as `applyOps`.
_Avoid_: execute, run, push

**Deploy**:
The end-to-end consumer-facing action: load config, build desired, **Diff**, **Apply**, write **State**. Implemented as `deploy()`, the package's primary entry point.
_Avoid_: run, sync, push, reconcile

**Reconcile**:
The conceptual umbrella for "make **Current state** converge toward **Desired state**": what the **Operations** represent (`noop` = already reconciled, `create` = reconcile an absent **Resource**, `update` = reconcile a drifted one) and what the kind-level `assertReconcilable` hook asserts. Not an action; `Deploy` and `Apply` are the actions at different scopes.
_Avoid_: deploy, apply, sync

**Drift**:
Field-level disagreement between **Desired state** and **Current state** for a paired **Resource**. Detected per-**Kind** by the **Kind module**'s `fieldsEqual` (boolean) and `changedFieldsBetween` (field-name list); produces an `update` **Operation** when present, a `noop` when absent.
_Avoid_: divergence, delta

### Plugin contracts

**Driver**:
The per-**Kind** plugin contract for the I/O half of reconciliation: implements `create` (and optionally `update`) against upstream Roblox APIs via `@bedrock-rbx/ocale`, returning **Outputs**. Surfaced in code as `ResourceDriver<K>`, registered in a `DriverRegistry` keyed by **Kind**; name follows the Terraform / Pulumi / Mantle IaC convention for a per-resource adapter (driven port despite the word).
_Avoid_: provider, client, backend, port

**Kind module**:
The per-**Kind** plugin contract for the non-I/O half of reconciliation: authored-entry schema, `flatten` (project resolved config into pre-I/O inputs), `normalize` (layer file reads and hashing to produce **Desired state**), drift detection (`fieldsEqual` / `changedFieldsBetween`), and optional `assertReconcilable` invariants. Surfaced in code as `ResourceKindModule<K>`, registered in a `KindRegistry` keyed by **Kind**.
_Avoid_: schema module, handler, type module

**State port**:
The plugin contract for **State** persistence: `read(environment)` returns the existing **State** or `undefined`, `write(state)` overwrites it. Surfaced in code as `StatePort`; selected at runtime by the user's **Backend** choice in config.
_Avoid_: storage, persistence layer

**Progress port**:
Optional plugin contract for receiving per-**Resource** and aggregate progress events during **Deploy** (started, succeeded, failed, noop, summary, state-written). Surfaced in code as `ProgressPort` and supplied via `DeployOptions.progress`; omit to run silently.
_Avoid_: logger, reporter, telemetry

**Backend**:
The user-facing discriminator in config that selects which **State port** adapter to construct at runtime (e.g. `state: { backend: "gist" }` picks the Gist adapter). Each backend value names exactly one adapter; today only the State port is backend-configurable.
_Avoid_: provider, driver, storage

### Code generation

**Codegen**:
Opt-in feature that writes deployed **Outputs** to persisted source files the game references by **Key** instead of by hardcoded ID. Off by default — the floor is Mantle parity, where IDs live only in **State** and consuming them is the user's problem.
_Avoid_: scaffolding, templating, asset map

**Emitter**:
The user-overridable function that turns deploy state into generated file content for **Codegen**. Receives state for every declared **Environment** (fresh for the one just deployed, last-known for the rest) and returns the files to write; bedrock ships a default so the simple case needs no code, while a custom emitter owns its layout entirely.
_Avoid_: generator, formatter, template, renderer

**Two-phase deploy**:
The deploy mode that rebuilds a place artifact when the generated source it embeds would change. Splits the apply into an **asset stage** (apply assets, checkpoint state, run **Codegen**) and, after the **Codegen fingerprint** check, either a **republish stage** (invoke the **Rebuild hook**, publish the rebuilt places) when the fingerprint changed or a normal publish of the pre-built file when it did not. Activates only when a **Rebuild hook** is supplied **and Codegen is active** (or a **Pending rebuild** marker is set); without codegen the hook is inert and places publish in a single pass. Because the rebuild recompiles after codegen rewrites source, the deploy environment needs the build toolchain, not just a pre-built artifact.
_Avoid_: two-pass, multi-stage, rebuild deploy

**Rebuild hook**:
The injected callback bedrock invokes during a **Two-phase deploy** to regenerate the place artifact once new asset IDs exist. Bedrock owns the orchestration; the hook owns the build, taking the post-asset deploy state and returning an array of per-place entries, each carrying the place **Key** and its rebuilt artifact. Bedrock does not know how to build.
_Avoid_: builder, build step, compile hook

**Pending rebuild**:
A presence-only bookkeeping marker — a place **Key** listed in the `$bedrock` envelope's `pendingRebuild` list — recording a place whose required asset IDs have been minted but not yet embedded and republished. Set for every place at the checkpoint write when a **Two-phase deploy** activates; cleared per place on a successful republish (the key is removed, never set `false`; an empty list is omitted), so a happy-path state never shows it. Lets a two-phase deploy self-heal after a failed **Rebuild hook**, since the assets themselves now `noop`; a marker present with no hook available is a hard error.
_Avoid_: dirty flag, needs-redeploy, stale marker

**Codegen fingerprint**:
A single `Sha256Hex` of the **Codegen** output the currently-published place was last built against, stored as `codegenHash` in the `$bedrock` envelope. A **Two-phase deploy** rebuilds and republishes iff the freshly emitted hash differs from the stored one (or a **Pending rebuild** marker forces it); an unchanged hash publishes the pre-built file. Stored only on a successful republish, retained stale on an aborted rebuild so the next deploy retries — the trigger that supersedes the old "any provisioned `create`" rule, catching mutable-field (price, name) drift the create rule missed. Diff-ignored like the marker; an absent stored hash (clean first deploy) reads as "differs".
_Avoid_: checksum, etag, revision, dirty hash

**`$bedrock` namespace**:
The reserved, **adapter-private** key on the on-disk state envelope carrying bedrock's own bookkeeping — the schema `version`, the **Pending rebuild** list, and the **Codegen fingerprint** (`codegenHash`) — distinct from user-declared desired state and Roblox-returned **Outputs**. Adapters flatten it on read into typed `BedrockState` fields and re-wrap it on write; nothing outside an adapter sees the raw key, and its contents never participate in **Drift**.
_Avoid_: metadata, internal, reserved

### Patterns

**Adoption**:
The kind-level pattern where the user supplies the Roblox identifier (`universeId`, `placeId`) on the authored entry because Open Cloud cannot create the upstream entity. The `universe` and `place` **Kinds** are adopted; `gamePass` and `developerProduct` are provisioned, meaning bedrock creates them and learns the assigned ID as an **Output**.
_Avoid_: import, attach, claim

**Managed field**:
A field bedrock owns the value for on a **Resource**'s **Desired state**: the **Diff** treats unmanaged fields (key absent or `undefined`) as non-drift and the **Driver** omits them from the wire request. Clearable fields are tri-state: an absent key is unmanaged, a present `undefined` clears the server value, and a set value writes through.
_Avoid_: writable field, declared field, owned field

**Redaction**:
Per-**Resource** (or per-**Environment**) opt-in to bedrock-supplied placeholder content on the wire, used to deploy structurally real but content-hidden resources to pre-release environments. Triggered by a `redacted` field; the placeholder set is per-**Kind** and may be overridden via the object form of the `redacted` field on the root entry.
_Avoid_: obfuscation, masking, scrubbing
