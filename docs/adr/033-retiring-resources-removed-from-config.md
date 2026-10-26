# ADR-033: Retiring Resources Removed from Config

**Date:** 2026-10-26 **Status:** Proposed

Decision Makers: Maintainer  
Tags: architecture, state, diff, config, breaking-change

## Context

ADR-019 deferred deletion: a **Resource** present in **Current state** but
absent from **Desired state** (an **Orphan**) is ignored by **Diff**, and its
state entry stays forever. The user gets no signal that bedrock stopped managing
it, and the live item keeps its old configuration. For a game pass or developer
product that means it stays on sale and keeps one of the universe's on-sale
slots.

Roblox cannot delete any **Kind** bedrock manages, so "remove" has to mean
something other than a delete. What Open Cloud allows, per **Kind**:

| Kind                           | Writable through Open Cloud                                                                     | Not possible through Open Cloud                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `gamePass`, `developerProduct` | name, description, `isForSale`, price, icon (replace only)                                      | delete; clearing the icon (the localized DELETE refuses the source language) |
| `place`                        | display name, description, server size, publishing a new version                                | delete; removing the place from its universe; archive                        |
| `universe`                     | name and description only through the root place; `deactivate` (experimental, API key or OAuth) | delete; archive                                                              |

Mantle, which bedrock replaces, deleted implicitly during `deploy` with no
guard. It renamed passes, products, and badges to
`zzz_DEPRECATED(<UTC timestamp>)` and cleared their descriptions, set passes off
sale and products to price 0, removed non-start places from the experience and
reset their configuration, and archived the experience only on `mantle destroy`.
Several of those calls used cookie-authenticated endpoints that ADR-007 rules
out.

Implicit removal has one failure that matters more than any other here. The
**Key** reads like a name, so users rename it. A key changed from `vip-pass` to
`vip-pass-plus` looks to **Diff** exactly like "remove one pass, add another".
Under implicit removal, bedrock retires the live pass and creates a new one with
a new asset ID; every script and purchase check keyed on the old ID stops
recognising buyers, and a retired pass cannot be restored. Nothing in config or
state can tell a renamed key from a genuine replacement, so the tool cannot
detect the mistake. Most deploys run in CI, so an interactive confirmation
cannot be the guard either.

## Decision

### Removal is explicit by default

An **Orphan** is an error. `diff`, `provision`, and `deploy` fail before any
**Operation** is applied, and the error names each orphaned key together with
the two ways to resolve it: mark it retired, or declare the rename.

The user retires a **Resource** by replacing its entry with a marker:

```ts
const config = {
	passes: {
		"vip-pass": { retired: true },
	},
};
```

- `retired: true` **Retires** the resource: bedrock hides the live item as far
  as Open Cloud allows, then drops its **Current state** entry.
- `retired: "untrack"` **Untracks** it: bedrock drops the state entry and does
  not touch the live item.

A `retired` entry carries no other fields. Once no **Environment** holds the
key, the marker does nothing and the user may delete it (see "Removing the
marker" below).

### Renames are declared, never inferred

`movedFrom: "<old key>"` on an entry moves the old key's **Current state** entry
to the new key, so bedrock keeps managing the same live item:

```ts
const config = {
	passes: {
		"vip-pass-plus": {
			name: "VIP Pass Plus",
			movedFrom: "vip-pass",
			price: 500,
		},
	},
};
```

- `movedFrom` names a key of the same **Kind**.
- In an **Environment** where the old key has no state entry, `movedFrom` does
  nothing and the entry diffs as usual.
- If both the old and the new key have state entries, the run fails: two live
  items cannot become one.

Adopted **Kinds** carry their Roblox identity in config, so for them no
declaration is needed. A `place` entry whose `placeId` matches an **Orphan**'s
is that place under a new key, and bedrock treats it as a rename. Bedrock never
retires a place that a **Desired state** entry still adopts.

### Retire and untrack are Operations

The `Operation` union gains two variants, each carrying `current`:

- `retire`: each **Kind module** declares its retire behavior and each
  **Driver** implements it; a new **Kind** cannot be added without one.
- `untrack`: needs no Roblox call, so **Apply** handles it for every **Kind**
  without dispatching to a **Driver**, the way it already skips `noop`.

Both drop the resource's **Current state** entry once they succeed, through one
shared path. Until now the state write only merged applied results over the
prior entries and never removed one.

Keeping untrack in the union means **Diff** still returns one complete list:
both variants come from the same `retired` marker, and a side list for one of
them would change the shape of the result anyway. The progress port and the
apply summary report both with no special handling. `diff` lists each, with the
item's name and Roblox ID, so the user sees which live item changes before
`deploy`.

### What retire does per Kind

| Kind                           | Retire                                                                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gamePass`, `developerProduct` | Name `zzz_DEPRECATED(<UTC timestamp>)`, description `""`, `isForSale: false`, and the redacted placeholder icon (ADR-024) for every locale with an icon asset in state |
| `place`                        | Display name `zzz_DEPRECATED(<UTC timestamp>)`, description `""`, server size `1`. The root place is refused.                                                          |
| `universe`                     | Refused                                                                                                                                                                |

The name format matches Mantle's, so migrated projects see one convention.
Products go off sale through `isForSale` rather than Mantle's price 0, because
Open Cloud exposes the flag.

### Universe and root place are refused, not retired

Removing the `universe` block, or retiring it, fails every command before any
**Operation** runs, with "Universe removal is not available at this time." The
refusal is a kind-level rejection raised before reconcile, the same path as the
existing icon-removal rejection, so a universe removal stops the whole run and
not just its own step.

Retiring the root place is refused the same way. Roblox derives the universe's
name and description from the root place, so retiring it would rename the whole
experience, and a root place cannot leave its universe. Bedrock finds the root
from the universe's `rootPlaceId` output when the universe is managed; the
driver also reads the place's `root` flag before changing anything, for projects
that do not manage the universe.

A deliberate way to stop managing, or to deactivate, a universe is left to a
later decision. It must be a separate, explicit action, never a side effect of
editing config.

### Partial failure keeps the state entry

Retire is several writes. Each is idempotent, and the state entry is dropped
only when all of them succeed. A retire that fails part-way keeps its entry, so
the next deploy retries it. This follows ADR-023's continue-on-failure semantics
and matches Mantle, which kept a failed delete in state.

### Environments

`retired` on a root entry applies to every **Environment**. On an environment
overlay it applies to that **Environment** only and overrides the root entry's
fields, so a resource can be retired in `development` and kept in `staging`.

A `retired` key with no state entry in the current **Environment** diffs to
`noop`. That covers both an **Environment** where it is already retired and one
where it was never created.

### Removing the marker

After `diff` and `deploy`, bedrock reads the last-known **State** of every
**Environment**, the same read **Codegen** already performs. When none holds a
`retired` key, it reports that the marker can be removed. Otherwise it lists the
**Environments** that still hold the resource. `movedFrom` gets the same report.

### Implicit removal is an opt-in

A top-level `orphans` setting selects the policy:

- `"error"` (default): as above.
- `"retire"`: an **Orphan** is retired as if it were marked `retired: true`.
  This is Mantle's behavior, for users who prefer it.

`movedFrom`, `retired`, and the universe and root-place refusals apply in both
modes.

## Consequences

### Positive

- A renamed key can no longer retire a live pass or product by accident. The run
  stops and names the fix.
- Bedrock stops leaving retired items on sale and stops carrying orphan entries
  in state.
- The marker is temporary: it can be deleted once every **Environment** has
  deployed, and bedrock says when.
- Users who want Mantle's behavior keep it with one setting.

### Costs

- Breaking for programmatic consumers: an exhaustive `switch` over `Operation`
  must handle `retire` and `untrack`. Shipped as a `minor` bump under the
  pre-1.0 policy.
- Breaking for existing projects: state files may already hold orphans, because
  bedrock has ignored them until now. The first run after upgrading fails on
  them. `retired: "untrack"` resolves each one without touching Roblox.
- Each removal now takes a config edit and, later, a second edit to delete the
  marker.
- Stricter than Mantle by default, so a migrated project that relied on implicit
  deletion must either declare its removals or set `orphans: "retire"`.
- Retire can only hide. The item stays visible on Roblox under its
  `zzz_DEPRECATED` name, a retired place stays in its universe, and a retired
  icon is a placeholder, not an absence.
- Bedrock reads every **Environment**'s **State** on each `diff` and `deploy`.

## Alternatives Considered

### Implicit retire on absence (Mantle, Terraform, Pulumi, CloudFormation)

The common default. Rejected as the default because a key rename destroys the
identity of a purchasable item and cannot be undone, and CI deploys leave no
room for a confirmation. Kept as the `orphans: "retire"` opt-in.

### Block only when one diff retires and creates the same Kind

Implicit retire, except that a retire and a create of the same **Kind** in one
diff stop the run until the user writes `movedFrom` or a `replaces` marker. It
keeps simple removals automatic. Rejected: no surveyed tool uses this rule, it
misses a rename whenever two keys change at once, and it blocks every genuine
replacement anyway.

### Warn only

Rejected: a warning in CI output does not stop the deploy that retires the pass.
No surveyed tool relies on a warning as its safety control.

### Detect renames by comparing fields

Rejected: a renamed entry may change its fields, and a genuine replacement may
share them. A guess in either direction either retires a live item or silently
rebinds state to the wrong one.

### Untrack-only for every Kind

Rejected: it leaves retired passes and products on sale, which is the problem
this decision exists to solve. Kept as `retired: "untrack"`.

## Survey

Surveyed on 2026-10-26 from each tool's documentation, and from source for
Mantle (commit `6103e6bc`):

| Tool                | On removal from config                        | Rename                    | Guard                                                     | Removable marker                       |
| ------------------- | --------------------------------------------- | ------------------------- | --------------------------------------------------------- | -------------------------------------- |
| Mantle              | Implicit hide-and-rename during `deploy`      | none                      | none                                                      | none                                   |
| Terraform, OpenTofu | Implicit destroy, shown in `plan`             | `moved` block             | `prevent_destroy` (not on config removal)                 | `removed` block, deletable after apply |
| Pulumi              | Implicit delete, shown in preview             | `aliases`                 | `protect`; `retainOnDelete` untracks                      | none                                   |
| CloudFormation, CDK | Implicit delete; a logical ID change replaces | `overrideLogicalId` (CDK) | `DeletionPolicy: Retain`; stack policies                  | none                                   |
| Argo CD             | Out of sync; prune off by default             | none                      | `Prune=false`, `Prune=confirm`                            | none                                   |
| Flux, Helm          | Prune when enabled                            | none                      | per-object prune opt-out; `helm.sh/resource-policy: keep` | none                                   |
| Crossplane          | Only on deleting the managed resource         | none                      | `deletionPolicy: Orphan`, `managementPolicies`            | none                                   |

This decision is Terraform's `moved` and `removed` model with Pulumi's `protect`
turned on by default.

## Related Decisions

- ADR-007: Open Cloud only, which rules out Mantle's place removal and
  experience archive.
- ADR-019: state data model and diff algebra. Its deletion deferral is lifted by
  this ADR.
- ADR-020: project config definition, which gains `retired`, `movedFrom`, and
  `orphans`.
- ADR-023: apply semantics, whose continue-on-failure rule retire follows.
- ADR-024: resource redaction, whose placeholder icon retire reuses.

## References

- [Mantle](https://github.com/blake-mealey/mantle)
- [Terraform `removed` block](https://developer.hashicorp.com/terraform/language/block/removed)
- [Terraform refactoring with `moved`](https://developer.hashicorp.com/terraform/language/modules/develop/refactoring)
- [Pulumi resource options](https://www.pulumi.com/docs/iac/concepts/options/)
- [CloudFormation `DeletionPolicy`](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-attribute-deletionpolicy.html)
- [Argo CD sync options](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-options/)
- [Flux Kustomization](https://fluxcd.io/flux/components/kustomize/kustomizations/)
- [Crossplane managed resources](https://docs.crossplane.io/latest/managed-resources/managed-resources/)
