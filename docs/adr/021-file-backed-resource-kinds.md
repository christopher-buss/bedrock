# ADR-021: Resource Update Capability for File-Backed Kinds

**Date:** 2026-04-22 **Status:** Accepted

Decision Makers: Maintainer
Tags: ports, resource-driver, apply-ops, public-api, file-backed

## Context

ADR-018 established `ResourceDriver<K>` as a driven port, a plugin contract
third-party authors implement. ADR-019 defined the `Operation` union and the
`diff` algebra for slice 1, and explicitly anticipated being reopened as new
resource kinds and operations land (its Revisit criteria name a second resource
type and the addition of `delete` as specific triggers). Both ADRs were authored
with game-pass as the sole resource kind: game passes are created by Roblox on
demand and the `create`-only port shape was sufficient at that scope.

Places introduce a structurally different class of resource. The Roblox Open
Cloud places API (shipped in `@bedrock/ocale` as PR #84) exposes `publish` and
`save` only. There is no create, list, or detailed read endpoint. Consequences:

- A place must already exist in Roblox before Bedrock can manage it. The place
  ID is a user-supplied input, not a Roblox-assigned output. The port cannot
  produce an ID on first apply.
- There is no authoritative upstream source to compare against for drift. The
  last-applied file hash stored in state is the only available drift signal. The
  `GetPlace` endpoint exposes `updateTime`, but a timestamp is too coarse to
  serve as a content-equality key; it changes on any edit including saves, tool
  moves, and unrelated publish events.
- The upstream call for "first publish" and "re-publish after drift" is
  identical. Treating them as distinct driver methods would be pure ceremony.

Assets (textures, audio, models) share these traits: they are uploaded by file
content, the file is the unit of managed content, and the publisher's ID is
supplied externally. Places are the first such kind; assets and similar kinds
are the anticipated continuation.

The current `ResourceDriver<K>` interface has only `create`. `applyOps`
returns an `updateUnsupported` error for every `update` operation regardless
of kind. Shipping place support requires extending the port to support `update`
without breaking the game-pass driver and without adding a mandatory method
that non-file-backed kinds need not implement.

Issue #99 implements the first file-backed kind (places). ADR-020 reserves
`places` as a config key mapping to the `place` kind; the per-kind entry schema
is owned by issue #99, not by this ADR.

## Decision

### Definition of file-backed kinds

A **file-backed resource kind** is one where:

1. A local file is the unit of managed content the driver publishes.
2. The upstream resource identifier is supplied by the user per entry in config;
   Roblox cannot create it on demand via Open Cloud.
3. The upstream API has no read surface suitable as a content-equality key;
   state is the source of truth for drift detection.

Places match all three criteria. Assets are anticipated to match all three when
implemented. Game passes match none: they are created by Roblox and return a
Roblox-assigned ID.

The `kind` discriminator on `ResourceDesiredState` (ADR-019) is unambiguous for
dispatch; no separate registry or marker interface is needed.

### Port change: optional `update` on `ResourceDriver<K>`

`ResourceDriver<K>` gains an optional `update` method:

```ts
export interface ResourceDriver<K extends ResourceKind> {
	create(
		desired: Extract<ResourceDesiredState, { kind: K }>,
	): Promise<Result<ResourceCurrentState<K>, OpenCloudError>>;

	update?(
		current: ResourceCurrentState<K>,
		desired: Extract<ResourceDesiredState, { kind: K }>,
	): Promise<Result<ResourceCurrentState<K>, OpenCloudError>>;
}
```

The method is optional (`?`). Drivers that do not implement `update` remain
valid `ResourceDriver<K>` implementations. No existing driver changes.

### `applyOps` dispatch for update operations

`applyOps` checks whether the driver exposes `update` before dispatching:

- If `driver.update` is defined, it is called with `(op.current, op.desired)`.
  Success and failure semantics mirror `create`: `Ok` returns the new current
  state; `Err` surfaces as `driverFailure`.
- If `driver.update` is absent, `applyOps` returns the existing
  `updateUnsupported` error. Behavior for drivers without `update` is
  unchanged.

### Drift detection for file-backed kinds (slice 1)

The file hash stored on the desired-state entry (for places: `fileHash` on
`PlaceDesiredState`) is the drift key. `diff` compares the desired hash against
the hash recorded in state from the last successful apply. A mismatch produces
an `update` op; a match produces a `noop`.

State is the source of truth. Out-of-band changes to a place (Studio publish,
other tools) are not detected. The `GetPlace.updateTime` field exists but is
too coarse for content-equality; a future ADR may introduce GET-based drift
detection when a suitable content-equality field is available.

### Create semantics for file-backed kinds

For file-backed kinds, a `create` op means "first-time tracked publish for this
key": the resource exists in Roblox already, but Bedrock has no prior state
entry for it. The driver's `create` implementation and `update` implementation
share an internal publish helper because the upstream call is identical either
way. This is a driver-implementation detail; the `diff` algebra from ADR-019
is unchanged.

### `placeId` is an input, not an output

`PlaceDesiredState` carries a `placeId: RobloxAssetId` field supplied by the
user in config. The Roblox publish response returns a `versionNumber`;
`PlaceOutputs` carries that value:

```ts
export interface PlaceOutputs {
	readonly versionNumber: number;
}
```

### Slice 1 scope

Slice 1 ships publish only; save, place metadata (name, description, max
players), and delete are deferred.

### Public API impact

The port change is additive. `update?` is optional; adding it to
`ResourceDriver<K>` does not require existing implementations to add a method.
`applyOps`'s new branch is additive behavior. The change warrants a
minor-version bump under pre-1.0 semver (new capability, backwards-compatible)
when shipped.

## Consequences

### Positive

- File-backed kinds (places, anticipated future assets) have a first-class
  driver contract. No workarounds, no special-cased `applyOps` branches per
  kind.
- Existing drivers (game-pass) are unchanged. The optional method preserves
  backwards compatibility for all current and future drivers that do not need
  `update`.
- `diff` algebra is unmodified. `create` / `update` / `noop` map to the same
  semantics regardless of kind; drivers absorb the per-kind interpretation.
- Plugin authors implementing a new file-backed kind have a clear pattern to
  follow: implement both `create` and `update`, delegate both to one internal
  publish helper.
- State-as-drift-source is simple and auditable. A `git diff` on the state
  file shows exactly which hash changed and when.

### Negative

- Out-of-band changes to a place (published via Studio or another tool) are
  invisible to `diff`. Bedrock will not detect or reconcile them until the
  user's config file hash is updated. This is a known limitation of the
  state-as-drift-source approach.
- `update?` is optional on the interface, which means TypeScript does not
  statically enforce that file-backed kinds implement it. A driver author
  who forgets `update` will get `updateUnsupported` errors at runtime, not
  a compile error. The pattern is documented but not enforced by the type
  system.
- `placeId` on desired state (rather than outputs) is an unusual shape
  relative to game-pass. Contributors encountering the first two resource
  kinds must learn that the pattern differs by kind. A code comment at the
  `PlaceDesiredState` declaration should explain why.

## Alternatives Considered

### Mandatory `update` on `ResourceDriver<K>`

Make `update` a required method, with drivers that do not support it returning
`updateUnsupported` from within their implementation.

**Rejected.** The game-pass driver is a published plugin contract. Making
`update` required would be a breaking change for all existing and future
drivers that only support create. The optional approach leaves the contract
additive while still enabling runtime dispatch.

### Separate `FileBackedDriver<K>` interface extending `ResourceDriver<K>`

Define a sub-interface that adds `update` as required. File-backed drivers
implement `FileBackedDriver<K>`; `applyOps` checks
`instanceof`/duck-type narrowing to dispatch.

**Rejected.** `instanceof` is fragile across module boundaries (ESM, bundling).
Duck-typing on `"update" in driver` achieves the same dispatch with less
ceremony and no new public interface to maintain. A second interface in the
public API also adds semver surface without a commensurate benefit: `update?`
on the single interface is sufficient for both plugin authors and for `applyOps`
dispatch.

### Use `GetPlace.updateTime` as the drift key

Compare `updateTime` from the Open Cloud `GetPlace` response against the
timestamp stored in state to detect out-of-band changes.

**Rejected for slice 1.** `updateTime` changes on any Studio edit, save, or
tool event, not only on publishes of the managed file. A timestamp-based
drift check would trigger spurious `update` ops after routine Studio work.
A content-equality field (checksum, version hash) does not currently exist
in the Open Cloud places API. The door is left open for a future ADR to
introduce GET-based drift once a suitable field is available.

## Implementation Notes

- `update?` is added to `packages/bedrock/src/ports/resource-driver.ts`.
  The `@example` block on `ResourceDriver<K>` should be extended to show a
  minimal file-backed driver implementing both `create` and `update` via a
  shared helper.
- `applyOps` in `packages/bedrock/src/shell/apply-ops.ts` dispatches the
  existing `update` op via `driver.update(op.current, op.desired)` when
  `driver.update` is defined. The `updateUnsupported` branch is retained as
  the fallback.
- `PlaceDesiredState` and `PlaceOutputs` are added to
  `packages/bedrock/src/core/resources.ts`. `ResourceDesiredState` becomes
  `GamePassDesiredState | PlaceDesiredState`; `ResourceOutputsByKind` gains
  `place: PlaceOutputs`.
- The place driver (`packages/bedrock/src/adapters/place-driver.ts`) implements
  `ResourceDriver<"place">` with both `create` and `update` delegating to an
  internal `publish` closure. The closure reads the file, detects format from
  the extension (`.rbxl` or `.rbxlx`), and calls
  `deps.client.publish({ body, format, placeId, universeId })`.
- `diff` in `packages/bedrock/src/core/diff.ts` requires a
  `switch (desired.kind)` in `desiredFieldsEqual` so place-specific fields
  (`placeId`, `filePath`, `fileHash`) are compared correctly, and TypeScript
  exhaustiveness ensures future kinds are handled explicitly.
- All new public exports ship with `@example` blocks per ADR-005.

## Related Decisions

- ADR-017: Product Framing: `ResourceDriver<K>` and `update?` are public API;
  the optional method is an additive minor-bump change under pre-1.0 semver.
- ADR-018: FCIS Ports: `ResourceDriver<K>` is a driven port; `applyOps` is a
  shell function. Both are modified by this ADR within their established roles.
- ADR-019: State Data Model: the `diff` algebra and `Operation` union are
  unchanged. This ADR extends driver dispatch only.
- ADR-020: Project Config Definition: reserves `places` as a config key
  mapping to `place`; per-kind entry schema is owned by issue #99.

## References

- PR #84: `@bedrock/ocale` places client (publish + save endpoints)
- Issue #99: first file-backed kind implementation (places resource driver)
- ADR-017, ADR-018, ADR-019, ADR-020: prior architectural decisions extended
  or referenced by this ADR
