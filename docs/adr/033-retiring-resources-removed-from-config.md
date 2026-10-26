# ADR-033: Retiring Resources Removed from Config

**Date:** 2026-10-26 **Status:** Accepted

Decision Makers: Maintainer

Tags: core, config, diff, state, retirement, safety, breaking-change

## Context

[ADR-019](./019-state-data-model-and-diff-algebra.md) deferred orphan detection
and deletion operations. A resource present only in Current state is silently
ignored: its state entry accumulates and the Roblox item keeps its old
configuration. A game pass or developer product can remain on sale, consuming an
on-sale slot, after its author intended to retire it.

Absence cannot safely imply retirement. Renaming `vip-pass` to `vip-pass-plus`
looks identical to retiring one pass and creating another. Automatic retirement
would take the existing pass off sale and create a replacement with a new Roblox
ID, breaking scripts and purchase checks that use the old ID. Config and State
cannot distinguish these intentions, and CI deploys cannot answer prompts.

Roblox has no permanent delete for the Kinds bedrock manages. Open Cloud can
change their metadata and sale status, but cannot delete passes or products,
remove a place from its universe, or archive it. Per Kind, from the vendored
Open Cloud spec:

| Kind                           | Writable through Open Cloud                                                                   | Not possible through Open Cloud                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `gamePass`, `developerProduct` | name, description, `isForSale`, price, icon (replace only)                                    | delete; clearing the icon (the localized DELETE refuses the source language) |
| `place`                        | display name, description, server size, publishing a new version                              | delete; removing the place from its universe; archive                        |
| `universe`                     | name and description only through the root place; deactivate (experimental, API key or OAuth) | delete; archive                                                              |

Mantle, which bedrock replaces, deleted implicitly during `deploy` with no
guard. It renamed passes, products, and badges to
`zzz_DEPRECATED(<UTC timestamp>)` and cleared their descriptions, set passes off
sale and products to price 0, left icons unchanged, removed non-start places
from the experience and reset their configuration, and archived the experience
only on `mantle destroy`. A failed delete stayed in its state. Place removal and
experience archival used cookie-authenticated endpoints that
[ADR-007](./007-open-cloud-only.md) rules out.

We therefore distinguish **Retire** (hide the live item as far as Open Cloud
allows, then drop its state entry) from **Untrack** (drop its state entry
without touching the live item). This decision records the design in
[#693](https://github.com/christopher-buss/bedrock/issues/693) and lifts
ADR-019's deletion deferral; it does not introduce a `delete` operation.

## Decision

### Explicit intent and rename safety

An **Orphan** is a Resource with a Current state entry and no matching Desired
state entry. The top-level `orphans: "error" | "retire"` setting defaults to
`"error"`. With that default, `diff`, `provision`, and `deploy` reject
unresolved orphans before any Operation is applied, any request reaches Open
Cloud, or any State is written. The error lists every orphan's Key and Kind, and
the three ways to resolve it:

- Replace the old entry with `{ retired: true }` to retire the live item.
- Replace it with `{ retired: "untrack" }` to stop managing it without changing
  the live item.
- Put `movedFrom: "<old key>"` on the new entry to declare a Key rename while
  preserving the existing Roblox ID.

Every Kind's resource-entry schema accepts `retired: true | "untrack"`, but a
retired entry must contain no other field. An entry in an Environment overlay
can carry `retired`; it overrides the root entry's fields for that Environment.
A root marker applies to every Environment. A marker for a Key with no Current
state in the selected Environment is a `noop`, covering already-retired and
never-created resources. These fields, `movedFrom`, and `orphans` are available
in every config format, including the Luau type definitions.

`movedFrom` names a Key of the same Kind. Before Diff, bedrock rebinds the old
Key's Current state to the new Key, preserving its Outputs; ordinary comparison
then produces an `update` or `noop`. When the old Key has no State in an
Environment, the declaration does nothing and the new entry diffs normally. Both
Keys already having State, or a cross-Kind declaration, rejects the run before
any Operation. A desired place whose `placeId` matches an orphaned place's
`placeId` is recognised as a rename without `movedFrom`. Bedrock must never
retire a place that another config entry still adopts.

Users who deliberately prefer Mantle's implicit behavior may opt into
`orphans: "retire"`. An unresolved, unmarked orphan then produces the same
`retire` Operation as `retired: true`. Rename resolution happens first, and the
universe and root-place protections still apply.

### Diff, Apply, and State

The public `Operation` union gains `retire` and `untrack`, each carrying
`current`, so one Diff result describes the whole plan without another lookup.
The Kind module and Driver contracts require retire behavior: each new Kind must
define its retirement path, including a refusal where necessary.

Apply dispatches `retire` to the matching Driver. Apply handles `untrack` for
every Kind without a Driver call, as it handles `noop` without one. Successful
retire and untrack Operations share an explicit state-drop path; simply merging
applied results over prior entries, as the current snapshot code does, cannot
drop an entry. An entry is dropped only on success. A retire that fails part-way
keeps its State entry for retry, and other Operations continue under
[ADR-023](./023-apply-semantics-parallel-continue-on-failure.md).

Retire steps must tolerate replay and converge after partial success. This does
not make remote changes and State persistence atomic: a failed State write still
uses ADR-023's `stateWriteFailed` / `unsavedState` recovery contract.
Per-resource progress events and the apply summary report retire and untrack
like other Operations. `bedrock diff` shows each with the item's name and Roblox
ID so the user can identify the affected live item before deployment.

### Per-Kind behavior and refusals

| Kind               | Retire behavior                                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gamePass`         | Name `zzz_DEPRECATED(<UTC timestamp>)`, description `""`, `isForSale: false`, and the existing redacted placeholder icon for every locale with an icon asset in State. |
| `developerProduct` | The same name, empty description, off-sale flag, and localized placeholder-icon behavior as a game pass.                                                               |
| `place`            | Display name `zzz_DEPRECATED(<UTC timestamp>)`, description `""`, and server size `1`.                                                                                 |
| `universe`         | Refused before reconcile; no Driver is called.                                                                                                                         |

The timestamped name follows Mantle's convention. Developer products use the
off-sale flag rather than Mantle's price-zero approach: changing the price is
not a substitute for making an item unavailable for purchase. Icons are replaced
with the existing placeholder from [ADR-024](./024-resource-redaction.md),
because Open Cloud cannot clear the source-language icon. Retirement reuses
those bytes, not redaction's configurable names or prices. Redaction preserves
management for a later reveal; retirement ends management after the live changes
succeed.

A universe present in State but absent from config, or marked `retired` in
config (including `"untrack"`), rejects every command before any Operation with
"Universe removal is not available at this time." Deliberately abandoning or
deactivating a universe requires a separate future decision.

Retiring the root place is refused because Roblox derives the experience's name
and description from it. When a managed universe's `rootPlaceId` Output
identifies the root place, reject the run before reconcile. The place Driver
also reads the place's root flag before writing. This protects projects without
a managed universe: a discovered root place fails that Operation before any
write, keeps its State entry, and does not cancel unrelated Operations.

### Temporary declarations across Environments

After `diff` and `deploy`, read the last-known State of every declared
Environment using the same cross-environment read already used by Codegen. For
each `retired` Key and each `movedFrom` old Key, report that the declaration can
be dropped only when no Environment holds that Key; otherwise list the
Environments still holding it (for example, "Still active in: staging"). A
backend read failure for another Environment reports its status as unknown and
does not fail the deploy. Unknown is not evidence that a declaration is safe to
drop. This report describes persisted State, not a fresh inventory of Roblox.

## Alternatives Considered

- **Keep silently ignoring orphans.** Leaves on-sale items active and users
  unaware that management stopped. It does not meet the intent of #693.
- **Retire on absence by default.** Cannot distinguish a renamed Key from a
  replacement and risks breaking ID-based scripts and purchase checks. Retained
  only as the explicit `orphans: "retire"` opt-in.
- **Retire on absence, but block when one Diff retires and creates the same
  Kind.** The run would stop until the new entry declared `movedFrom` or a
  `replaces` marker, keeping simple removals automatic. Rejected: the heuristic
  misses a rename whenever two Keys change in one edit, still blocks every
  genuine replacement, and no surveyed tool uses it.
- **Warn only.** A warning in CI output does not stop the deploy that retires
  the item, and no surveyed tool relies on a warning as its safety control.
- **Untrack on absence by default.** Avoids live mutation but silently discards
  identity, leaves items on sale, and makes a later renamed entry create a new
  item. Untracking must be explicit too.
- **Infer renames from similar fields or ask for confirmation.** Similar fields
  cannot prove identity and prompts do not work for unattended CI. Use
  `movedFrom`, with the place-ID match as the case where identity is proven.
- **Add a delete/destroy path, archive places, or publish an empty place.**
  Permanent deletion and place removal/archival are unavailable through Open
  Cloud; publishing an empty place was not chosen. Metadata retirement is
  bounded by the supported API surface. No legacy API is introduced.
- **Add a state-key rename command.** A temporary `movedFrom` declaration works
  across Environments and stays reviewable alongside config; a separate CLI
  rename mechanism is outside this decision.

## Consequences and Delivery

This is breaking for programmatic consumers with exhaustive `Operation`
switches, for Kind module and Driver implementers, and for projects whose State
already contains orphans. The implementation's breaking changes require `minor`
change intents for the fixed package group under the pre-1.0 policy. The orphan
error's changelog entry must explain the upgrade and point users who want to
preserve existing live items to `retired: "untrack"`. Other slices use the
change intents specified in their tickets. This documentation prerequisite
changes no runtime behavior and needs no package release.

This Accepted ADR and ADR-019's dated amendment must merge before
implementation. The delivery tickets are
[#817](https://github.com/christopher-buss/bedrock/issues/817) (untrack),
[#818](https://github.com/christopher-buss/bedrock/issues/818) (rename),
[#819](https://github.com/christopher-buss/bedrock/issues/819) (game-pass
retirement), [#820](https://github.com/christopher-buss/bedrock/issues/820)
(developer-product retirement),
[#821](https://github.com/christopher-buss/bedrock/issues/821) (place
retirement), [#822](https://github.com/christopher-buss/bedrock/issues/822)
(cleanup report), [#823](https://github.com/christopher-buss/bedrock/issues/823)
(default orphan rejection), and
[#824](https://github.com/christopher-buss/bedrock/issues/824) (implicit-retire
opt-in). During staged delivery, unsupported retire behavior must reject before
reconcile rather than silently untrack or partially apply. The default orphan
error lands after explicit resolution paths, and the opt-in lands after that
error. The developer-product icon-removal guidance must point to `retired: true`
instead of claiming an absent entry deletes the product.

Implementation must verify observable config-to-State behavior over fake Open
Cloud transport: requests, State dropped on success and kept on failure, safe
replay, rename identity, overlays, and refusals. CLI integration checks cover
errors, item identity in Diff output, and cross-environment reports. Pure Diff
branches and public type changes receive focused tests, with 100% source
coverage and no surviving changed-source mutants under repository policy.

Live probes during implementation still need to confirm empty-description
acceptance and moderation/uniqueness behavior for `zzz_DEPRECATED(...)` names,
including possible PATCH `409 Conflict` responses. These are not assumed to have
passed. A rejected retire must retain State and surface the failure. Retirement
cannot guarantee an item is inaccessible: a place remains in its universe and an
existing ID still identifies the live item. Badges and other future Kinds need
their own retire behavior when introduced. Universe actions, interactive
prompts, and clearing icons outright remain outside this decision.

## Survey

How comparable tools treat a resource that leaves config, surveyed on 2026-10-26
from each tool's documentation, and from source for Mantle (commit `6103e6bc`):

| Tool                | On removal from config                        | Rename              | Guard                                                     | Removable marker                       |
| ------------------- | --------------------------------------------- | ------------------- | --------------------------------------------------------- | -------------------------------------- |
| Mantle              | Implicit hide-and-rename during `deploy`      | none                | none                                                      | none                                   |
| Terraform, OpenTofu | Implicit destroy, shown in `plan`             | `moved` block       | `prevent_destroy` (not on config removal)                 | `removed` block, deletable after apply |
| Pulumi              | Implicit delete, shown in preview             | `aliases`           | `protect`; `retainOnDelete` untracks                      | none                                   |
| CloudFormation, CDK | Implicit delete; a logical ID change replaces | `overrideLogicalId` | `DeletionPolicy: Retain`; stack policies                  | none                                   |
| Argo CD             | Out of sync; prune off by default             | none                | `Prune=false`, `Prune=confirm`                            | none                                   |
| Flux, Helm          | Prune when enabled                            | none                | per-object prune opt-out; `helm.sh/resource-policy: keep` | none                                   |
| Crossplane          | Only on deleting the managed resource         | none                | `deletionPolicy: Orphan`, `managementPolicies`            | none                                   |

Most tools delete on absence and rely on plan review, with an explicit rename
declaration and a per-resource guard beside it. No surveyed tool uses a warning
as its safety control, and none blocks only when one diff removes and adds the
same type. This decision is Terraform's `moved` and `removed` model with
Pulumi's `protect` turned on by default.

- [Mantle](https://github.com/blake-mealey/mantle)
- [Terraform `removed` block](https://developer.hashicorp.com/terraform/language/block/removed)
- [Terraform refactoring with `moved`](https://developer.hashicorp.com/terraform/language/modules/develop/refactoring)
- [Pulumi resource options](https://www.pulumi.com/docs/iac/concepts/options/)
- [CloudFormation `DeletionPolicy`](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-attribute-deletionpolicy.html)
- [Argo CD sync options](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-options/)
- [Flux Kustomization](https://fluxcd.io/flux/components/kustomize/kustomizations/)
- [Crossplane managed resources](https://docs.crossplane.io/latest/managed-resources/managed-resources/)
