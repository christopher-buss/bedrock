# Bedrock Core

`@bedrock-rbx/core` is the IaC engine that reconciles user-declared desired state against live Roblox state via `@bedrock-rbx/ocale`, persisting per-environment snapshots between deploys. This context covers the vocabulary used to describe what bedrock manages, how reconciliation is structured, and the plugin contracts that let third parties extend the engine.

## Language

### Resources

**Resource**:
A single instance of a managed Roblox entity that bedrock reconciles between declared desired state and live state (e.g. a specific game pass keyed `"vip-pass"`, a specific place keyed `"start-place"`, the singleton universe).
_Avoid_: entity, item, thing

**Kind**:
The discriminator tag identifying which type of Roblox entity a **Resource** represents (`"gamePass"`, `"place"`, `"universe"`, `"developerProduct"`). Surfaced in code as the `ResourceKind` type.
_Avoid_: type, category, sort

**Key**:
User-supplied stable identifier for a **Resource** within a config (e.g. `"vip-pass"`), carried across deploys so desired and current state can correlate even when Roblox-assigned IDs are unknown. Surfaced in code as the branded `ResourceKey` type.
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
The per-**Environment** record bedrock persists between deploys: a versioned `BedrockState` carrying the list of **Current state** entries for that **Environment**. Read at the start of each **Deploy**, written at the end.
_Avoid_: snapshot, save, history

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
The shell step that dispatches each non-noop **Operation** to its matching **Driver** and collects the resulting **Outputs** into an updated **Current state** list. Implemented as `applyOps`.
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

**Backend**:
The user-facing discriminator in config that selects which adapter implements a plugin contract at runtime (e.g. `state: { backend: "gist" }` picks the Gist adapter for the **State port**). Each backend value names exactly one adapter.
_Avoid_: provider, driver, storage

### Patterns

**Adoption**:
The kind-level pattern where the user supplies the Roblox identifier (`universeId`, `placeId`) on the authored entry because Open Cloud cannot create the upstream entity. The `universe` and `place` **Kinds** are adopted; `gamePass` and `developerProduct` are provisioned, meaning bedrock creates them and learns the assigned ID as an **Output**.
_Avoid_: import, attach, claim

**Redaction**:
Per-**Resource** (or per-**Environment**) opt-in to bedrock-supplied placeholder content on the wire, used to deploy structurally real but content-hidden resources to pre-release environments. Triggered by a `redacted` field; the placeholder set is per-**Kind** and may be overridden field-by-field at the root entry.
_Avoid_: obfuscation, masking, scrubbing
