# ADR-035: Live State, Out-of-Band Edits, and Import

**Date:** 2026-11-09 **Status:** Accepted

Decision Makers: Maintainer

Tags: core, ocale, diff, apply, state, config, import, drift

## Context

Bedrock never reads a managed Resource back from Roblox. `diff` compares Desired
state against the Current state recorded at the last Apply
([ADR-019](./019-state-data-model-and-diff-algebra.md)), and the only Driver
reads today serve writes: the universe root place, the root-place guard on
retire, the icon asset id after an upload, and the free badge quota. Three gaps
follow, and each was raised separately:

- **Out-of-band edits are invisible.** A price changed on the Creator Dashboard
  stays until bedrock next writes that Resource. Because an `update` sends every
  managed field, a later change to another field (the icon) silently reverts it.
  A user cannot ask "does Roblox match my config?" without deploying.
- **Lost or never-written State makes duplicates.** A create that Roblox
  completes but answers with a 5xx or a timeout records no id; so does lost
  State or a discarded `stateWriteFailed`. The next Deploy creates a second
  item. ADR-023 already asked Drivers to "prefer adopt-over-create" here and
  nothing implemented it.
- **Existing items cannot be brought under management.** A team that adopts
  bedrock gradually ("add our developer products later") or arrives with an
  experience already live has no path other than the Mantle state migration.
  Adding new items works; taking over existing ones does not.

All three need the same capability: read **Live state** for a Kind, cheaply.
Costs measured against Roblox's published limits and live probes:

| Read                          | Cost for 40 passes, 100 products, 30 badges, 5 places |
| ----------------------------- | ----------------------------------------------------- |
| List endpoints, one page each | about 10 calls, 2-3 s                                 |
| One get per Resource          | 176 calls, 10-30 s                                    |

List items carry every compared field for game passes and developer products.
Read and write operations have separate queues in ocale, and the budget is per
owner (user or group), not per universe. Reads of the anonymous legacy badge and
place endpoints are limited per caller, which on shared CI runners likely means
per IP.

Probes also established what cannot be read: the original bytes of an icon
(Roblox re-encodes on upload and caps images at 1024 px; Open Cloud asset
delivery returns the stored file, thumbnails return resized renders), a place's
published content, and disabled badges in the anonymous universe badge list (the
single badge get still returns them). No Roblox write accepts an existing image
asset id: an icon is set only by uploading bytes.

Bedrock's model is that config owns every managed field of a tracked Resource.
An Out-of-band edit is a misuse to correct, not a value to preserve. Codegen
depends on this: it publishes config values (prices) as the truth that game code
reads.

## Decision

1. **Live state is read through the Driver.** `ResourceDriver<K>` gains optional
   `read` (one Resource by id) and `list` (all Resources of the Kind in the
   universe). They return Live state in the Current state shape, with fields
   that Roblox cannot return left absent. ocale gains the missing reads
   (developer-product list, badge get and list, place list, asset-delivery
   download).
2. **The live check is part of `diff` and `deploy`.** It runs automatically when
   an Open Cloud credential is available, uses list reads only, and is skipped
   with a visible note when no credential exists or a Kind has no list. `--live`
   makes it required (fail without a credential); `--no-live` turns it off. A
   tracked badge missing from the list is read with the single get. One get per
   Resource is never the default.
3. **Config wins.** Where the live check ran, the plan compares config against
   Live state. An **Out-of-band edit** (Current state against Live state) is
   reported by `diff` and reverted by `deploy`, which labels the `update` as a
   revert so it differs from ordinary Drift. `--fail-on-out-of-band-edit` stops
   the run instead, for audits. `update` keeps writing every managed field;
   partial updates are rejected (see Considered Options). A replaced icon is
   detected by comparing the live icon asset id with Outputs before refresh, and
   restored by a forced upload.
4. **Import is a Temporary declaration.** `importId: "<roblox id>"` on an
   Environment overlay entry names an existing live item. The next `diff` or
   `deploy` in that Environment reads its Live state and records it as Current
   state instead of planning a `create`, then diffs normally. Nothing is written
   before that run, so an Import is reviewed in the same PR and plan as any
   other change, and CI holds the State credentials. The run fails before any
   Operation if the id is not live in that universe, is another Kind, is tracked
   by another Key, or the Key already has State. The cross-Environment report
   from [ADR-033](./033-retiring-resources-removed-from-config.md) says when
   each `importId` line can be removed. `importId` is not accepted on root
   entries: each Environment is one universe with its own ids.
5. **`bedrock import` writes config only.** One interactive flow: pick the
   source Environment, select untracked live items in a grouped tree, link the
   Keys in each other Environment (suggested by name after the display-name
   prefix is removed, or chosen by hand, with differing fields shown), review,
   write. Clearing a tracked item writes `retired: "untrack"`; the default
   `orphans: "error"` is unchanged. Keys are the kebab-cased name, suffixed on
   collision, editable before writing. The flow is a library function first; a
   non-interactive mode (`--environment`, `--select`, `--link`, `--yes`) serves
   CI and agents. Config is edited in place wherever one entry can be written
   safely (YAML, JSON, literal TS/JS objects), decided per entry; otherwise the
   entries are printed for the user to paste. An item that exists in only one
   Environment cannot be imported until config can declare Environment-only
   entries.
6. **Icons stay required and file-backed.** Import downloads the stored icon
   through Open Cloud asset delivery into the repository and writes its path;
   the first Deploy records that file's hash as the baseline without uploading.
   When the download is not possible, the user supplies a file and a temporary
   `iconBaseline: "accept-local-file"` beside `importId` records that the file
   is the user's claim, not a verified copy.
7. **Redacted Environments.** A link compares Live state against that
   Environment's redacted Desired state, not the root's real values. Importing
   from a redacted Environment writes live values to the root, refuses values
   equal to a redaction placeholder, and warns that the next Deploy redacts the
   item.
8. **No silent name match.** Before a planned `create`, the live check looks for
   an untracked live item of the same name. If one exists, the run fails before
   any Operation and prints the `importId` line to add. The one automatic case
   is same-run create recovery: when a `create` fails with a 5xx or a timeout,
   bedrock lists the Kind again, and if exactly one item with that exact name
   appeared since the pre-Apply list, records it as the result of that create
   and reports "create recovered".
9. **Primitives for hosts.** Read, compare (Current against Live), and a pure
   refresh (Live state into new State) are public library API. Policies that
   share ownership of fields with end users stay in the host. There is no
   `bedrock refresh` command.

## Considered Options

- **Partial updates (send only Drifted fields).** Rejected. It would leave an
  Out-of-band edit in place until the config changed that field, which
  contradicts config ownership and Codegen. A host that shares ownership gets
  the same safety by refreshing State and building Desired state from Live state
  plus its patch.
- **Write every field on every Deploy.** Rejected: 170-500 writes per Deploy for
  the same end state as the live check, new icon assets and place versions each
  run, and load on the owner's shared budget.
- **Live check opt-in only.** Rejected: at list cost it is close to the existing
  Capacity check, and a default-off check misses the case it exists for (an edit
  nobody announced).
- **The picker writes State.** Rejected: discarding the config change would
  leave Orphans, which `orphans: "error"` stops on and `orphans: "retire"` would
  retire; it would also require State credentials on developer machines.
- **Import by name match automatically.** Rejected: it would take over items
  made by hand without review. A name match only suggests.
- **A root `orphans: "untrack"` policy.** Rejected: one deleted line would
  untrack silently, and the `error` default is what makes removal safe.
- **Optional icons, or icons given as an asset id.** Rejected: optional icons
  weaken whole-Resource ownership; an asset id cannot be written to Roblox and
  cannot be reproduced in another Environment.
- **More than one universe per Environment.** Not adopted. Several universes
  belong to separate projects or configs, not to one Environment.

## Consequences

- `diff` needs an Open Cloud credential for the full result. Runs without one
  (pull requests from forks) still work and say what they skipped.
- Badge and place lists rely on unauthenticated legacy endpoints that the
  vendored spec documents, within the rule of ADR-034 decision 6. Their per-IP
  limits on shared CI runners are the main operational risk.
- Asset delivery uses a scope Roblox marks "Not Recommended", and access to
  group-owned assets is unverified (#933). The `iconBaseline` fallback covers
  both failures.
- An accepted icon baseline can be wrong; the icon then stays wrong until the
  next upload. The temporary line makes that claim visible in review.
- `importId`, `iconBaseline`, and the new Driver methods change the config
  schema and a public port: TS/Luau parity applies, and this is a `minor`
  release.
- A place's published content remains undetectable
  ([ADR-021](./021-file-backed-resource-kinds.md)); only its metadata takes part
  in the live check.

## Amendment: 2026-11-12, asset delivery does not restrict images by owner

The Consequences said that access to group-owned assets was unverified. Live
probes (#933) settle it: Open Cloud asset delivery
(`GET /asset-delivery-api/v1/assetId/{assetId}`) returns the stored file of any
image to any caller with `legacy-asset:manage`. Owner, group membership and
group role permissions have no effect. The probes covered:

- A group-owned image, read by the group owner and by a member whose role has no
  experience, monetization or development-item permission.
- Game-pass icons in a group universe. An icon belongs to the user who uploaded
  it, not to the group, and another member could read it.
- Images from creators with no relation to the caller.
- An API key and an OAuth token. For `legacy-asset:manage` an OAuth grant
  carries only the user, so a group cannot be selected at consent; a group-owned
  API key acts for the user who created it. Neither changes the result.

The `409` "User is not authorized to access Asset." comes from restricted asset
types, such as a place owned by a group the caller is not in. It does not apply
to images. Import downloads only icons, so the key it deploys with can download
every stored icon, including in group-owned universes.

Decision item 6 is unchanged. The `iconBaseline: "accept-local-file"` fallback
now covers an icon that cannot be downloaded for another reason: a deleted,
archived or moderated asset, or a scope Roblox stops granting. These cases were
not probed.
