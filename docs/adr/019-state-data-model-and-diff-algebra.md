# ADR-019: State Data Model and Diff Algebra -- Mantle Parity

**Date:** 2026-04-17  **Status:** Accepted

Decision Makers: Maintainer  
Tags: state, data-model, diff, types, mantle, migration, core

## Context

ADR-017 established that Bedrock's core types are a public API surface. ADR-018
placed them in `packages/cli/src/core/` as pure data structs with no I/O. This
ADR specifies what those types are: the data contracts that slice 1 freezes and
that all future slices, plugin authors, and programmatic users depend on.

Bedrock's primary migration constraint (CLAUDE.md) is maintaining a path from
Mantle. Mantle's data model therefore anchors the design:

- Mantle uses serde's untagged-enum pattern for its `RobloxInputs` variants --
  the discriminator is implicit in the nested object key (e.g.
  `inputs: { pass: {...} }` vs `inputs: { experience: {...} }`). We use an
  explicit `kind` field at the top level of each resource, following the
  TypeScript discriminated-union convention. The two representations carry the
  same information; our mapping is more idiomatic for TS.
- Mantle persists `{ inputs, outputs }` per resource. We follow the same
  structure: desired-state inputs are the authoritative description; outputs are
  Roblox-returned identifiers.
- Mantle serialises per-environment state in a single combined YAML file. We
  depart from this in format (JSON) and layout (one file per environment) while
  preserving the semantic content.
- Mantle hashes its entire serialised inputs blob for change detection. We reject
  this: we use field-by-field comparison where file-backed fields (e.g.
  `iconFileHash`) carry an explicit pre-computed hash. This is simpler to
  reason about, avoids serialisation-order sensitivity, and allows future
  partial-update optimisation.

Three design tensions shaped the specific choices:

1. **Mantle parity vs. TypeScript idioms.** Mantle's Rust code uses `snake_case`
   with `serde(rename_all = "camelCase")`. We use `camelCase` natively, which
   matches Mantle's serialised output and eases migration comparisons.

2. **Flat vs. nested type shapes.** A `spec`-nested shape
   (`{ kind, key, spec: { name, price } }`) is common in Kubernetes-style IaC.
   We use a flat shape (`{ kind, key, name, price }`) because it reduces
   accessor depth, matches Mantle's flat resource representation, and is simpler
   to narrow in TypeScript discriminated unions.

3. **Pure core vs. I/O in types.** `buildDesired` must hash icon files (I/O).
   The hash result is stored as `iconFileHash` on `ResourceDesiredState`, keeping
   `diff` pure. The hashing step lives in `shell/` (ADR-018); the hash field
   lives in `core/`.

## Decision

### Core types

The following types are the slice-1 data contracts. They live in
`packages/cli/src/core/` and are exported from `packages/cli/src/index.ts` as
public API (ADR-017).

```ts
import type { Simplify, Tagged } from "type-fest";

// ── Branded primitives ────────────────────────────────────────────────────────

/** User-supplied identifier for a resource within a config (e.g. "vip-pass"). */
export type ResourceKey = Tagged<string, "ResourceKey">;

/** Roblox-assigned numeric asset ID, represented as a string to avoid int64 loss. */
export type RobloxAssetId = Tagged<string, "RobloxAssetId">;

/** Lowercase hex-encoded SHA-256 digest of a local file. */
export type Sha256Hex = Tagged<string, "Sha256Hex">;

// ── Desired state ─────────────────────────────────────────────────────────────

/** Desired state for a game pass, as declared in user config. */
export interface GamePassDesiredState {
	/** User-supplied key; stable across deploys; used to correlate desired ↔ current. */
	readonly key: ResourceKey;
	readonly name: string;
	readonly description: string;
	/** SHA-256 hex digest of the icon file, computed by `buildDesired` in shell. */
	readonly iconFileHash: Sha256Hex;
	/** Path to the icon file on disk, relative to the config file. */
	readonly iconFilePath: string;
	readonly kind: "gamePass";
	/**
	 * Robux price. `null` means off-sale (mirrors Mantle's `Option<u32>`).
	 * Omit to leave pricing unchanged on update (not valid for create).
	 */
	readonly price: null | number;
}

/**
 * Discriminated union of all desired-state types.
 * Extend by adding new members to this union — no other type changes needed.
 */
export type ResourceDesiredState = GamePassDesiredState; // | BadgeDesiredState | ...

// ── Outputs ───────────────────────────────────────────────────────────────────

/** Roblox-returned identifiers for a game pass after create or update. */
export interface GamePassOutputs {
	readonly assetId: RobloxAssetId;
	readonly iconAssetId: RobloxAssetId;
}

// ── Current state ─────────────────────────────────────────────────────────────

/** The string union of all resource kind discriminators. */
export type ResourceKind = ResourceDesiredState["kind"];

/**
 * Per-kind output types. Add a new entry for each new resource kind.
 * Implemented as a mapped interface so adding a `ResourceKind` variant without
 * a matching entry here is a compile error.
 */
export interface ResourceOutputsByKind {
	gamePass: GamePassOutputs;
	// Adding a kind without an entry here is a compile error.
}

/**
 * Resolved outputs for a specific resource kind `K`.
 * @template K The resource kind discriminator.
 */
export type ResourceOutputs<K extends ResourceKind> = ResourceOutputsByKind[K];

/**
 * Current (live) state for a resource kind `K`.
 * Composed as: the matching desired-state shape plus a nested `outputs` object.
 * The `outputs` sub-object is kept nested (not flattened) to mirror Mantle's
 * structure and produce clean migration copy.
 * @template K The resource kind discriminator.
 */
export type ResourceCurrentState<K extends ResourceKind = ResourceKind> = Simplify<
	Extract<ResourceDesiredState, { kind: K }> & { readonly outputs: ResourceOutputs<K> }
>;

// ── Operations ────────────────────────────────────────────────────────────────

export interface CreateOperation extends BaseOperation {
	readonly desired: ResourceDesiredState;
	readonly type: "create";
}

export interface UpdateOperation extends BaseOperation {
	readonly current: ResourceCurrentState;
	readonly desired: ResourceDesiredState;
	readonly type: "update";
}

export interface NoopOperation extends BaseOperation {
	readonly current: ResourceCurrentState;
	readonly type: "noop";
}

/**
 * Discriminated union of all operation types.
 * A `delete` variant is intentionally absent from slice 1 — see Decision notes.
 */
export type Operation = CreateOperation | NoopOperation | UpdateOperation;

interface BaseOperation {
	/** Resource key; hoisted to op-level for uniform access across all op types. */
	readonly key: ResourceKey;
}
```

### `diff` function

`diff` is a pure, synchronous function in `core/`. It returns a plain array --
no `Result` wrapper because there is no I/O and no trust boundary.

```ts
/**
 * Computes the operations required to reconcile `current` state with `desired`
 * state. Pure and synchronous: no I/O, no side effects.
 *
 * - Each entry in `desired` is matched to `current` by `key`.
 * - A key present in `desired` but absent in `current` produces a `create` op.
 * - A key present in both produces an `update` op if any field differs, or a
 *   `noop` op if all fields match.
 * - Keys present in `current` but absent in `desired` are NOT emitted as ops
 *   in slice 1 (delete is deferred; see Decision notes below).
 * @param desired - The declared desired state from user config.
 * @param current - The last-known live state from the state file.
 */
export function diff(
	desired: ReadonlyArray<ResourceDesiredState>,
	current: ReadonlyArray<ResourceCurrentState>,
): ReadonlyArray<Operation> {
	/* ... */
}
```

### Delete deferral

A `delete` operation variant and "orphan" detection are **explicitly deferred**
from slice 1. Resources present in `current` state but absent from `desired`
config are silently ignored by `diff` -- they are not emitted as any operation
type. Users who remove a resource from config must delete it manually via the
Roblox dashboard until a future slice ships the `delete` variant.

This is a deliberate product choice, not an oversight. The `Operation` union's
absence of a `delete` variant documents the intent to any future contributor.

### State file format

Bedrock writes one JSON state file per environment. The file is named
`state.<environment>.json` (exact storage path is determined by the `StatePort`
adapter -- e.g. a Gist adapter stores it as a Gist file; a local adapter stores
it under `.bedrock/`).

**v1 file shape:**

```json
{
	"$bedrock": { "version": 1 },
	"environment": "production",
	"resources": [
		{
			"kind": "gamePass",
			"key": "vip-pass",
			"name": "VIP Pass",
			"description": "Grants VIP perks.",
			"price": 500,
			"iconFilePath": "assets/vip-icon.png",
			"iconFileHash": "a3f2...e1b0",
			"outputs": {
				"assetId": "9876543210",
				"iconAssetId": "1122334455"
			}
		}
	]
}
```

Each entry in `resources` is a `ResourceCurrentState` serialised to JSON.
`camelCase` is used throughout, matching Mantle's serialised output for
migration-friendly comparison.

### `StatePort` contract

`StatePort` is a driven port (ADR-018) whose `read()` and `write()` methods
handle state file I/O. The `read()` return type handles two legitimate outcomes:

`BedrockState` is the **in-memory** shape. The **on-disk** shape wraps it with
a `$bedrock: { version: N }` envelope (shown in the JSON example above).
Adapters flatten the envelope on read (extracting `version` from `$bedrock`) and
re-wrap it on write. Nothing outside an adapter ever sees the raw `$bedrock` key.

```ts
import type { OpenCloudError, Result } from "@bedrock-rbx/ocale";

export interface BedrockState {
	readonly environment: string;
	readonly resources: ReadonlyArray<ResourceCurrentState>;
	readonly version: 1;
}

export interface StateError {
	readonly file: string;
	readonly kind: "stateError";
	readonly reason: string;
}

export interface StatePort {
	/**
	 * Reads state for the given environment.
	 * - Returns `Ok(null)` when no state file exists (legitimate first deploy).
	 * - Returns `Err(StateError)` when a file exists but cannot be parsed
	 *   (corrupt JSON, schema failure, unknown `$bedrock.version`).
	 *   Never silently falls back to empty state.
	 */
	read(environment: string): Promise<Result<BedrockState | null, StateError>>;

	/** Writes state for the given environment, overwriting any existing file. */
	write(state: BedrockState): Promise<Result<void, StateError>>;
}
```

Unknown `$bedrock.version` values must produce a `StateError` with a message
that names the file, the declared version, and the range of supported versions.
No silent parse. No best-effort handling.

### Mantle migration notes

The `bedrock migrate` command (a future slice) converts a Mantle state file:

1. Reads `.mantle-state.yml` (Mantle's combined `environments:` YAML map).
2. For each environment, re-computes file hashes from disk (Mantle's hashes are
   serialisation-dependent and cannot be trusted directly).
3. Writes one `state.<environment>.json` per environment in Bedrock's v1 format.

The re-hash-on-migration strategy is flagged here as a known requirement but is
not implemented in slice 1. The migration slice will formalise it.

## Consequences

### Positive

- Type shapes are Mantle-compatible at the semantic level: `kind`, `key`,
  `inputs`, `outputs` map directly to Mantle's resource fields. Migration tooling
  has a clear target.
- `diff` is pure and sync. It can be called from programmatic scripts, tests, and
  the CLI without any async plumbing (ADR-017 use case: drift assertions).
- `ResourceCurrentState<K>` is derived from `ResourceDesiredState` via
  `Simplify<Extract<...> & { outputs }>`. Adding a new desired-state field
  automatically propagates to current state; no parallel type maintenance.
- JSON state format is simpler to parse than YAML, produces clean `git diff`
  output, and requires no additional runtime dependency.
- One file per environment means a staging deploy does not churn the production
  state file. `git diff` and PR reviews are scoped to the affected environment.
- `$bedrock: { version: 1 }` wrapper from day 1 eliminates the schema-migration
  bootstrapping problem. A future breaking schema change bumps to `version: 2`
  and can provide a migration path without a rip-and-replace.
- Hard error on malformed state prevents silent data loss. A corrupt state file
  that silently collapses to empty state would cause `applyOps` to re-create
  every resource on Roblox -- potentially destructive.

### Negative

- Flat discriminated union grows linearly with resource types. With six v1.0
  resource types the union is manageable; with dozens it may warrant a
  registry-based approach. Revisit criteria below.
- No `delete` variant in slice 1. Users who remove a resource from config must
  delete it manually on the Roblox dashboard. Orphaned resources accumulate in
  Roblox until a future slice ships the `delete` operation.
- File hashes (`iconFileHash`) must be computed and stored explicitly. If a user
  moves an icon file without changing its content, the hash stays the same but
  `iconFilePath` changes -- causing a spurious update on the icon field. This is
  the correct behaviour (the path changed), but it may surprise users who expect
  content-addressable diffing.
- `StatePort.read()` returning `null` for file-not-found requires callers to
  handle the null case explicitly rather than treating missing state as an empty
  resource list. This is correct (the distinction between "no file" and "empty
  resources" may matter for future diagnostics) but adds a branch at every call
  site.
- Departing from Mantle's YAML format means the `bedrock migrate` conversion
  step is required. Users cannot point Bedrock at an existing Mantle state file
  and expect it to work without migration.

### Neutral

- `ResourceKey` is user-supplied and opaque to Roblox. It is distinct from
  `RobloxAssetId`. This distinction must be documented clearly in user-facing
  config docs to avoid confusion ("why does my `key: "vip-pass"` not match the
  Roblox asset ID `9876543210`?").
- `price: null` semantics (off-sale) match Mantle's `Option<u32>`. Users
  migrating from Mantle will find this familiar; new users may find `null`
  surprising compared to `isForSale: false`. This is a UX decision deferred to
  the config/docs slice.

### Revisit criteria

This ADR should be reopened if any of the following occur:

- **A second resource type is added.** The flat discriminated union and
  per-kind output type pattern should be re-evaluated once there are two
  real resource types. If the per-kind boilerplate is manageable, continue; if
  it is growing into a maintenance burden, a codegen or registry-based approach
  should be considered before the pattern solidifies further.
- **The migration slice ships.** The re-hash-on-migration strategy described
  here ("re-compute file hashes from disk") becomes concrete implementation.
  If the strategy turns out to be impractical (e.g. icon files are no longer
  on disk at migration time), the fallback needs a decision. ADR-019 should be
  amended or a child ADR created at that point.
- **The `delete` operation lands.** The `Operation` union gains a `delete`
  variant and orphan-detection logic enters `diff`. The orphan-accumulation
  consequence documented above is resolved. ADR-019's Decision section should
  be updated to reflect the expanded union.
- **`$bedrock.version` needs a bump.** Any breaking change to the state file
  schema (adding a required field, renaming a key, changing a type) must
  increment `version` and provide a documented migration path. The trigger
  condition is: a v1 file read by a newer Bedrock would produce incorrect
  behaviour if silently accepted. Non-breaking additions (optional fields) do
  not require a version bump.

## Alternatives Considered

### YAML state format (Mantle parity)

Write state files as YAML to match Mantle's `.mantle-state.yml` format, enabling
direct file comparison during migration.

**Rejected.** Migration is a one-time `bedrock migrate` conversion, not an
ongoing parallel-write requirement. YAML parity during migration does not require
Bedrock's own format to be YAML. JSON is simpler to parse without a runtime
dependency, produces cleaner `git diff` output for per-field state changes, and
is more natural for the programmatic API (JSON.stringify/parse, no serialisation
library needed in `StatePort` implementations).

### Combined `environments:` map (Mantle's layout)

Store all environments in a single file: `{ environments: { production: [...],
staging: [...] } }`, matching Mantle's `BTreeMap<String, Vec<RobloxResource>>`.

**Rejected.** A staging deploy would rewrite a file that also contains
production state, inflating `git diff` noise and widening the blast radius of a
backend write failure. Bedrock's state backends (Gist, S3, R2) treat each stored
object as a named blob; one file per environment is a natural fit and makes
atomic per-environment writes straightforward.

### Mantle-style blob-hash change detection

Hash the entire serialised inputs blob (as Mantle does) to detect changes,
rather than comparing fields individually.

**Rejected.** Blob hashing is sensitive to serialisation order and format
changes. A whitespace change in the config file or a field reordering would
produce a spurious update. Field-by-field comparison is explicit, predictable,
and allows future partial-update optimisation (e.g. skip the icon upload if only
`name` changed). File-backed fields carry an explicit hash (`iconFileHash`)
computed by `buildDesired` in shell; this is the only case where a hash appears
in the data model, and its meaning is unambiguous.

### Spec-nested desired state (`{ kind, key, spec: { name, price } }`)

Wrap resource-specific fields under a `spec` sub-object, following
Kubernetes-style IaC conventions.

**Rejected.** Adds accessor depth without benefit at the slice-1 resource count.
TypeScript discriminated union narrowing works directly on flat fields; a `spec`
wrapper requires narrowing the outer union and then accessing `spec`, adding a
level of indirection at every call site. Mantle's flat resource shape is
migration-friendly and sufficient for the v1.0 resource set.

## Implementation Notes

- `ResourceDesiredState`, `ResourceCurrentState`, `ResourceKey`, `RobloxAssetId`,
  `Sha256Hex`, `Operation`, and `diff` are exported from
  `packages/cli/src/index.ts` as public API per ADR-017.
- `StatePort`, `BedrockState`, and `StateError` are driven-port types
  (ADR-018). They are exported from `packages/cli/src/ports/state-port.ts`
  and re-exported from `src/index.ts`.
- `buildDesired` (shell) reads icon files and produces `iconFileHash` before
  calling `diff`. `diff` never reads files. This boundary must be preserved
  as new file-backed resource types are added.
- The `DriverRegistry` type maps `ResourceKind` to its `ResourceDriver<K>`
  implementation. `applyOps` (shell) receives a `DriverRegistry` and dispatches
  each `Operation` to the appropriate driver. The registry type is:

```ts
export type DriverRegistry = {
	[K in ResourceKind]: ResourceDriver<K>;
};
```

- **Parent-scope identifiers are injected at apply time, not stored on desired
  state.** Roblox Open Cloud requires a `universeId` on every game-pass
  operation, yet `GamePassDesiredState` intentionally carries no `universeId`
  field — matching Mantle's `PassInputs`, which also omits it. Instead, the
  scope is threaded into the driver at construction: `createGamePassDriver({
  client, universeId })` captures the universe in a closure. Slice 1 hardcodes
  the universeId at the test boundary because experience is not yet a managed
  resource. When experience becomes managed (a future slice shipping
  configuration-managed experience resources), `applyOps` will topo-sort
  dependency order and thread the experience's `outputs.assetId` into the
  game-pass driver at instantiation. Public types do not change during that
  refactor — only `applyOps` and the driver-construction path evolve.

- The `Tagged` pattern from type-fest produces branded types whose brand is
  erased at JSON-serialisation boundaries. Adapters that read state from disk or
  accept user input must therefore re-apply brands via type-level constructor
  helpers (`asResourceKey(raw: string): ResourceKey`,
  `asRobloxAssetId(raw: string): RobloxAssetId`,
  `asSha256Hex(raw: string): Sha256Hex`). These constructors live in `core/`
  alongside the branded type definitions. They perform runtime validation
  (e.g. `asSha256Hex` verifies the string is 64 lowercase hex characters)
  before returning the branded value, ensuring the compile-time guarantees
  are backed by runtime checks at every deserialization boundary.

## Related Decisions

- **ADR-009**: Result Types Over Exceptions -- `StatePort.read()` and
  `StatePort.write()` return `Promise<Result<T, StateError>>`. `diff` does not
  return a `Result` because it is pure and cannot fail.
- **ADR-011**: Simplified Architecture for Library Packages -- the CLI package
  fails ADR-011's opt-out criteria (substantive pure core separable from I/O,
  swappable driven adapters, significant deployment logic). The types defined
  here are precisely the "pure core separable from I/O" that criterion 4
  identifies. ADR-011's verdict (CLI uses FCIS + Ports) is confirmed.
- **ADR-017**: Product Framing -- all types exported from `src/index.ts` are
  public API with semver stability obligations. Type renames and shape changes
  are breaking changes that require a CHANGELOG entry during 0.x and a major
  version bump at 1.0+.
- **ADR-018**: Architecture Refinement -- core types live in
  `packages/cli/src/core/`; `StatePort` and `ResourceDriver<K>` live in
  `packages/cli/src/ports/`; `buildDesired` (which hashes files) lives in
  `packages/cli/src/shell/`. The I/O boundary established in ADR-018 is
  enforced by this ADR's type placement.

## Amendments

- **2026-04-19:** The `StatePort.read` sketch in the `StatePort` contract
  section and in the "no state file" narrative uses `BedrockState | null` and
  `Ok(null)`. In code this is modelled as `BedrockState | undefined` and
  `Ok(undefined)`, because `null` is banned project-wide under the
  `unicorn/no-null` ESLint rule. The contract is unchanged: "no state file
  yet" stays a distinct success value from "file with empty resources list",
  and a malformed file must still surface as `Err(StateError)` rather than
  collapsing to that sentinel. See `packages/cli/src/ports/state-port.ts`.

- **2026-06-23 (`realDisplay` sibling):** `BedrockState` gains an optional
  `realDisplay` field — a map keyed by the `kind:key` composite carrying the
  real (pre-redaction) display values for redacted resources, so a codegen
  emitter can recover what redaction (ADR-024) hid behind placeholders. On disk
  each entry is co-located as an adapter-private `$realDisplay` key on the
  resource object it describes (mirroring the `$bedrock` envelope's
  "nothing outside an adapter sees it" property); `serializeStateFile` and
  `parseStateFile` own the on-disk ↔ in-memory mapping. This is **not** a
  diff-algebra change: `diff` and the state merge (`mergeResources`) operate on
  the resources array and never read the sibling, so the field-by-field
  comparison and the `Operation` union are untouched and the diff stays
  redaction-blind. It is also **not** a schema-version bump: `realDisplay` is an
  optional, additive field per this ADR's `$bedrock.version` revisit criterion
  (a v1 file read by a newer bedrock, or a newer file read by an older bedrock,
  behaves correctly), and a happy-path file with no redacted resources never
  carries it. The decision to persist real values in the (confidential) state
  backend is recorded in ADR-024's 2026-06-23 amendment.
