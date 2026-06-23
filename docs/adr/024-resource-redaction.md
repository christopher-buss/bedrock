# ADR-024: Resource Redaction for Pre-Release Environments

**Date:** 2026-05-14  **Status:** Accepted

Decision Makers: Maintainer  
Tags: config, core, schema, wire-contract, security

## Context

Bedrock pushes each resource's real `name`, `description`, and `icon` to Open
Cloud on every deploy. Those fields render on the experience's roblox.com page.
A Roblox browser extension that bypasses the unreleased-place gate can expose
that page to anyone who knows the URL, leaking in-development monetization
metadata before a release.

No mechanism exists to deploy "structurally real but content-hidden" resources.
Manual workarounds -- editing placeholders on the dashboard, maintaining a
parallel dev-names config -- break IaC reproducibility.

The threat model is a Roblox-rendered page made accessible through an
access-control bypass. This is not a defense against an actor with the
developer's Open Cloud credentials or access to the source config repository.

## Decision

Add a `redacted` field to the project config schema (ADR-020) that opts a
resource or environment into bedrock-supplied placeholder content. When active,
bedrock substitutes placeholders for display metadata before pushing to Open
Cloud. The real values stay in config and ship only when redaction is lifted.

### Authored shape

Resource-entry shape varies by kind, reflecting each kind's underlying field names.

For `gamePass`, `developerProduct`, and `badge`:

```ts
interface PassEntry {
	redacted?: boolean | { description?: string; icon?: Record<"en-us", string>; name?: string };
}
```

For `universe` (note `displayName`, not `name`):

```ts
interface UniverseEntry {
	redacted?:
		| boolean
		| { description?: string; displayName?: string; icon?: Record<"en-us", string> };
}
```

Environment-overlay level:

```ts
interface EnvironmentEntry {
	redacted?: boolean;
}
```

No project-root-level field. Enabling per-env on each non-production environment
is the expected pattern.

The object form implies redaction is enabled (specifying an override turns it
on). An empty object (`redacted: {}`) is a validation error; authors must write
`redacted: true` for defaults. Override keys are restricted to the redactable
field set for that kind; unknown keys (e.g. `price`) are validation errors.
Both rejections attribute the offending field path.

### Resource-kind scope

- In scope: `universe`, `gamePass`, `developerProduct`, `badge`
- Out of scope: `place` (the `.rbxl` file is the content, not metadata);
  `module` (no display surface)

### Per-kind default field sets

| Kind                | Redacted by default               |
| ------------------- | --------------------------------- |
| `gamePass`          | `name`, `description`, `icon`     |
| `developerProduct`  | `name`, `description`, `icon`     |
| `badge`             | `name`, `description`, `icon`     |
| `universe`          | `description`, `icon` only        |

The universe asymmetry is deliberate: `displayName` surfaces in Roblox Studio's
place picker and the Creator Hub experience list -- developer-facing tools the
experience owner needs to identify their own work. Redacting it by default would
make the experience harder to locate during development than before redaction was
enabled. Authors who need full opacity write
`universe.redacted: { displayName: 'Hidden Project' }` explicitly.

### Precedence

Most-specific layer wins:

```text
environments['x'].passes['k'].redacted
  > passes['k'].redacted
  > environments['x'].redacted
```

Per-resource inside an env overlay beats per-resource at root, which beats the
env-level boolean. `redacted: false` at a more-specific layer carves out an
exception in an otherwise-redacted env.

### Bedrock-supplied placeholder defaults

| Kind               | Name field    | Default                                  | `description` | `icon`                    |
| ------------------ | ------------- | ---------------------------------------- | ------------- | ------------------------- |
| `gamePass`         | `name`        | `"Redacted Pass"`                        | `""`          | embedded placeholder PNG  |
| `developerProduct` | `name`        | `"Redacted Product"`                     | `""`          | embedded placeholder PNG  |
| `badge`            | `name`        | `"Redacted Badge"`                       | `""`          | embedded placeholder PNG  |
| `universe`         | `displayName` | (no default; explicit override required) | `""`          | embedded placeholder PNG  |

The placeholder PNG ships as an inlined `Uint8Array` in `@bedrock-rbx/core`. A
sentinel path constant is assigned when `applyRedaction` substitutes an icon;
`readBytes` recognizes the sentinel and returns the embedded bytes. Downstream
normalize and driver upload paths receive bytes through the existing interface
unchanged.

### Pipeline placement

```text
load config
  -> validate
  -> select environment (merge env overlay)
  -> applyRedaction         <-- new pure transform
  -> render displayName prefix
  -> flatten per-kind
  -> normalize per-kind (hash icons; sentinel resolves through readBytes)
  -> diff
  -> apply via drivers
```

`applyRedaction` is a pure function in `core/redact-resources.ts`. It receives a
`ResolvedConfig` and returns a `ResolvedConfig`; no I/O. Placement between
env-overlay merge and display-name-prefix application means an explicitly
redacted universe `displayName` composes with the prefix: `[DEV] Hidden`, not
the real name with a prefix.

### State and diff

The state file records the values that were actually pushed -- placeholders for
redacted resources. Diff compares desired against current with no special-cased
path. A redacted resource whose config-level real name is edited produces a noop
(the placeholder did not change); the plan output surfaces this case explicitly
so the noop is not silent.

No state-file schema bump. No diff-algebra change. ADR-019 is unaffected.

### Validation

arktype narrows enforce:

- `redacted: {}` -- rejected; error attributed to the field path
- `redacted: { price: 0 }` -- rejected; error names `price` as an unknown override key
- `environments['x'].redacted: { name: 'X' }` -- rejected; env overlay accepts boolean only
- `redacted: true`, `redacted: false`, `redacted: { name: 'X' }` -- all accepted

## Consequences

### Positive

- Developers can deploy to a dev environment without exposing real monetization
  metadata on the roblox.com experience page.
- Additive config extension: authors who do not declare `redacted` see exactly
  current behavior. No migration, no state-file bump.
- Redaction state is reproducible: the same config produces the same placeholders
  on every deploy, preserving IaC guarantees.
- Drift detection works without modification: the state records placeholders, so
  a manual dashboard edit to a redacted resource shows as drift on the next run.
- `applyRedaction` is pure and independently testable. No adapters, no I/O.
- The sentinel-path approach keeps the normalize and driver upload paths
  unchanged; no per-kind code needs to know about redaction.

### Negative

- Universe `displayName` asymmetry is a wart: `redacted: true` on universe does
  not redact the display name, which may surprise authors who expect uniform
  treatment. The override escape hatch exists but requires extra explicit config.
- A per-resource override at root (e.g. `passes['x'].redacted: { name: 'Closed Beta' }`)
  is overridden by any redacted setting on the same resource inside an env overlay,
  including a bare `redacted: true`. Authors who want a root-level custom placeholder
  to apply in every env must leave that resource's `redacted` field absent from
  env overlays, or repeat the override on each env overlay's entry.
- Plan output must explicitly surface the "noop due to redaction" case to prevent
  silent surprises when the real name changes in config but the placeholder does
  not. Failing to implement that annotation faithfully would undermine user story
  8 (the plan-output story).
- Localized `name` and `description` redaction is out of scope: those fields are
  single strings in the current schema. When per-locale name and description land,
  redaction will need to fold them into the default field set.

## Alternatives Considered

### Env-level override object (`environments.dev.redacted: { name: 'Closed Beta' }`)

An env-level field that accepts the full override object, not just boolean, would
allow a single custom placeholder applied across all kinds in that env.

**Rejected.** The use cases that motivated this feature are satisfied by
per-resource overrides at the resource entry level. A cross-kind env-level
override object introduces questions about kind-specific field eligibility
(e.g. universe does not redact `name` by default) that per-resource overrides
do not. Complexity deferred until a concrete use case demands it.

### Project-root-level redaction toggle

A top-level `redacted: true` that redacts every redactable resource across all
environments.

**Rejected.** Bedrock configs enumerate environments explicitly. Redacting
everything in all environments, including production, is not a use case the
feature serves; the threat is dev/staging leakage, not production leakage.
Per-env redaction on non-production environments is sufficient and less dangerous.

### Separate placeholder config file

A sidecar file (e.g. `bedrock.redacted.config.ts`) holding placeholder values,
merged at load time.

**Rejected.** Adds a second config-discovery concern and a new load-time artifact
for a feature that composes naturally as a field on existing resource entries.
The `redacted` field is authored alongside the resource it affects, keeping the
config self-contained.

### Encrypt or omit real values from the state file

Rather than storing placeholder content, store encrypted real values or omit
display metadata from state entirely.

**Rejected.** Encryption requires key management and makes `diff` dependent on a
secret at runtime. Omitting display metadata from state breaks drift detection.
The threat model is Roblox-side leakage through a page-access bypass, not state
file compromise; authors who need state-file confidentiality should choose a
locked-down state backend.

## Implementation Notes

New modules in `core/`:

- `redact-resources.ts` -- `applyRedaction(config: ResolvedConfig): ResolvedConfig`.
  Owns precedence resolution, per-kind default field sets, and substitution.
  Single exported function; no I/O.
- `redacted-icon.ts` -- embedded placeholder PNG as `Uint8Array`, sentinel path
  constant, `isRedactedIconPath` predicate.

Modified:

- `core/schema.ts` -- extends each redactable entry type with `redacted?:
  boolean | RedactedOverride` and each env-overlay type with `redacted?: boolean`.
  arktype narrows reject empty-object form, unknown override keys, and object form
  on env overlays.
- `core/select-environment.ts` -- calls `applyRedaction` between env-overlay
  merge and display-name-prefix application.
- `core/kinds/read-bytes.ts` -- short-circuits the sentinel path to embedded
  bytes.
- `shell/preview-diff.ts` (or the diff renderer) -- annotates plan output with a
  "redacted in \<env\>" line per redacted resource so real-value edits that
  produce a noop are surfaced.

## Related Decisions

- ADR-017 -- Product Framing: the `redacted` field is part of the public config
  API surface.
- ADR-018 -- FCIS + Ports: `applyRedaction` is a pure core transform; no I/O,
  no ports.
- ADR-019 -- State Data Model and Diff Algebra: explicitly not amended; this
  design is additive within the existing data model and diff contract.
- ADR-020 -- Project Config Definition: this ADR extends the schema ADR-020
  defines. The per-resource entry schema and the env-overlay schema both gain
  the `redacted` field.

## Amendment -- 2026-05-16

The original Decision named `universe` as a redactable kind with a default field
set of `description` and `icon`. Implementation found that universe owns neither
field as wire-pushable today:

- `icon` for the universe is blocked upstream. Open Cloud has no endpoint to
  set a universe's source-language game icon. The block is tracked in the
  Mantle-feature-blocked register; see issue #362.
- `description` is not owned by `universe`. The universe's description is
  derived server-side from the root place's `description` field, which already
  lives on `PlaceEntry`. The redactable description field is therefore on the
  `place` kind, not on `universe`.

`displayName` remains the only universe field redactable today, routed through
`PlacesClient.update` on the root place (same path the universe driver uses).

The asymmetric-default design (preserve `displayName` so Roblox Studio's place
picker and the Creator Hub experience list still identify the developer's own
work) transfers from `universe` to `place`. Places already declare both
`description` and `displayName` on their entry shape, so the same default set
applies cleanly.

### Per-kind default field sets (revised)

| Kind                | Redacted by default               | Override field set                                   |
| ------------------- | --------------------------------- | ---------------------------------------------------- |
| `gamePass`          | `name`, `description`, `icon`     | `{ name?, description?, icon? }`                     |
| `developerProduct`  | `name`, `description`, `icon`     | `{ name?, description?, icon? }`                     |
| `badge`             | `name`, `description`, `icon`     | `{ name?, description?, icon? }`                     |
| `place`             | `description` only                | `{ description?, displayName? }`                     |
| `universe`          | (none today; see notes)           | `{ displayName? }` once wired                        |

Universe-level redaction is deferred until either the icon endpoint lands
upstream (resolves the `icon` half) or the design migrates to publishing
`displayName` overrides through the existing universe path. The `redacted`
field on `UniverseEntry` is not yet present in the schema and will be added
when there is a concrete redactable target.

### Placeholder defaults (revised)

| Kind               | Field         | Default                                  |
| ------------------ | ------------- | ---------------------------------------- |
| `gamePass`         | `name`        | `"Redacted Pass"`                        |
| `gamePass`         | `description` | `""`                                     |
| `gamePass`         | `icon`        | embedded placeholder PNG                 |
| `developerProduct` | `name`        | `"Redacted Product"`                     |
| `developerProduct` | `description` | `""`                                     |
| `developerProduct` | `icon`        | embedded placeholder PNG                 |
| `badge`            | `name`        | `"Redacted Badge"`                       |
| `badge`            | `description` | `""`                                     |
| `badge`            | `icon`        | embedded placeholder PNG                 |
| `place`            | `description` | `""`                                     |
| `place`            | `displayName` | (no default; explicit override required) |

## Amendment -- 2026-05-19

Two changes to the `developerProduct` name default since the 2026-05-16
amendment:

1. **Hashed suffix (PR #426).** The bare shared default `"Redacted Product"`
   collided with Roblox's per-universe uniqueness constraint on dev-product
   names. The default now embeds a 6-hex SHA-256 digest of the resource key
   so every redacted entry resolves to a unique wire value.
2. **Prefix change to `"Hidden Product"` and removal of the `#` separator.**
   Live smoke testing against Anime Rush surfaced that Roblox's text
   moderation filter silently replaces some names matching
   `Redacted Product #<hex>` with `########################` (24 hashes, one
   per source character). Once one product's name moderates to that string,
   every other redacted entry whose proposed name *would also* moderate to
   the same string is rejected at PATCH time with `DuplicateProductName`
   (Roblox's uniqueness check runs against the post-moderation value, not
   the submitted one). Dropping the word `Redacted` and the `#` separator
   produces names of the form `Hidden Product <hex>` that the moderation
   filter has been observed to pass cleanly.

The `gamePass` default `"Redacted Pass"` is unchanged: game-pass names do not
enforce per-universe uniqueness on Roblox, so a moderation-induced collapse
to `########################` cannot cascade into apply failures.

The prefix swap is a stop-gap: the moderation filter is opaque and the
pattern that passes today could stop passing tomorrow. Sturdier options
(post-PATCH moderation-drift detection, moving uniqueness off the
human-readable name, pre-validating against a Roblox filter endpoint) are
tracked in [issue #431](https://github.com/christopher-buss/bedrock/issues/431).

### Placeholder defaults (revised again)

| Kind               | Field  | Default                          |
| ------------------ | ------ | -------------------------------- |
| `developerProduct` | `name` | `` `Hidden Product ${suffix}` `` |

Other rows are unchanged from the 2026-05-16 table above.

## Amendment -- 2026-05-19 (env-scope overrides and field-level merging)

Four coupled changes: three lift restrictions the original Decision placed on the redaction surface, and one bumps the default for the price field added in [#427](https://github.com/christopher-buss/bedrock/pull/427).

### Default redacted price for game-pass and developer-product

`REDACTED_PRICE` becomes `99999`. The original Decision's Placeholder defaults table did not cover `price`; [#427](https://github.com/christopher-buss/bedrock/pull/427) introduced `price` as a redactable field with an implicit default of `1`. The bump is a fail-safe shift. A misconfigured redacted resource erring on "unbuyable" is preferable to one erring on "accidentally cheap": the former is embarrassing, the latter risks revenue loss and premature reveal of monetization metadata.

Off-sale resources (`price: undefined`) continue to stay off-sale through redaction; the default applies only when a real price is set.

### Placeholder defaults (price-aware)

| Kind               | Field   | Default                  |
| ------------------ | ------- | ------------------------ |
| `gamePass`         | `price` | `99999` (when on-sale)   |
| `developerProduct` | `price` | `99999` (when on-sale)   |

Other rows are unchanged from earlier tables.

### Env-level cross-kind override object accepted

The "Env-level override object" alternative is no longer deferred. A concrete use case has surfaced: an author needs every redactable product and pass in an env to ship with `{ price: 1 }` (or another uniform override) without repeating the override per resource.

`environments.<env>.redacted` accepts `boolean | RedactedEnvironmentOverride | undefined`, where `RedactedEnvironmentOverride` carries the union of redactable fields across kinds:

| Field         | Applies to                                                  |
| ------------- | ----------------------------------------------------------- |
| `name`        | `gamePass`, `developerProduct`                              |
| `description` | `gamePass`, `developerProduct`, `place`                     |
| `icon`        | `gamePass`, `developerProduct`                              |
| `price`       | `gamePass`, `developerProduct`                              |
| `displayName` | `place`, `universe` (when explicitly redacted via override) |

Per-kind application: each redactable kind picks up only the fields its own override type supports. Fields a kind does not recognize are silently ignored for that kind. The "kind-specific field eligibility" concern raised in the original Alternatives Considered section is resolved by this rule.

### Per-resource env-overlay object form accepted

Each per-resource entry inside an env overlay (`environments.<env>.passes.<key>`, `.products.<key>`, `.places.<key>`) accepts the kind's existing override object form alongside `boolean`. The env-overlay surface aligns with the root resource entry, removing the public-API asymmetry where the exported `RedactedGamePassOverride`, `RedactedDeveloperProductOverride`, and `RedactedPlaceOverride` types appeared usable wherever `redacted` was mentioned but were rejected at env scope. Covers user story 17 from the PRD ([#408](https://github.com/christopher-buss/bedrock/issues/408)).

### Field-level merging precedence

Layers compose field-by-field rather than whole-object. The original Precedence section's "most-specific layer wins" reading was consistent with both whole-object and field-level merging because only one layer (root-resource) carried object form; the question had no observable answer. With object form at every layer the choice is explicit.

Layer order remains most-specific to least-specific. Short forms below are convenient nicknames used through the rest of this amendment:

```text
env-resource (per-resource inside an env overlay)
  > root-resource (per-resource at root)
  > env-level (cross-kind on the env entry)
```

Resolution is two-step:

1. **State.** The first non-undefined `redacted` value sets the redaction state. `false` carves out: the resource is not redacted and lower layers are moot. `true` or object form enables redaction; proceed to step 2.
2. **Fields.** Walk every object-form layer encountered (most-specific to least-specific). Merge fields with the most-specific layer's value winning per field. Boolean `true` contributes no fields. Bedrock kind defaults fill any field still unset.

Canonical example: `products.myProduct.redacted = { name: "Hidden" }` at root combined with `environments.dev.redacted = { price: 1 }` at env-level resolves, for dev's `myProduct`, to `{ name: "Hidden", price: 1 }` plus kind defaults for `description` and `icon`.

The Negative section clause about authors needing to "repeat the override on each env overlay's entry" is superseded: root-level overrides now compose with env-level and env-resource overrides automatically.

## Amendment -- 2026-06-23 (real values in confidential state for codegen)

The original Decision (State and diff section) recorded that "the state file
records the values that were actually pushed -- placeholders for redacted
resources", and the "Encrypt or omit real values from the state file"
alternative was rejected with the reasoning that real values "stay in config".
That holds for the diff and apply paths, but it leaves a gap for codegen
(ADR-026): an emitter that writes real names/prices/descriptions into generated
game source reads from **State**, not config, and State carried only the
placeholders. Identity (asset IDs in `outputs`) already flows to codegen because
outputs are never redacted; the gap is the *display* values.

This amendment is a deliberate, scoped reversal: the real (pre-redaction)
display values for a redacted resource are now **persisted in the state
backend**, alongside the placeholders, so codegen can recover them.

### Diff-ignored sibling

Each redacted resource gains a namespaced, diff-ignored sibling in the state
file. On disk it is co-located as a `$realDisplay` key on the resource object
(adapter-private, like the `$bedrock` envelope); in memory it is a
`BedrockState.realDisplay` map keyed by the `kind:key` composite the diff uses.
`serializeStateFile` / `parseStateFile` own the on-disk ↔ in-memory mapping;
`diff` and the state merge operate only on the resources array and never read
the sibling. The scalar *pushed* fields, the per-kind drivers, and the diff
algebra are unchanged, so the diff stays redaction-blind: a redacted resource
whose real values change but whose pushed values do not still diffs as a `noop`.
The sibling carries only the redactable scalar fields that diverge from the
pushed value (`name`, `description`, `price`; place `displayName` /
`description`); `icon` is excluded because its actionable value is the asset ID
in `outputs`.

### Codegen-facing view and helpers

The polymorphism lives only in the codegen-facing view, never on the persisted
or diffed resource. `codegenView(resource, realDisplay)` presents each
redactable field as `Field<T> = T | { readonly value: T; readonly redacted: T }`
— a plain scalar when the field was not hidden, the object form (real `value`
plus `redacted` placeholder) when it was. The exported `realValue`,
`pushedValue`, and `isRedacted` helpers narrow the union so emitters never
hand-narrow it.

### Confidentiality constraint

This narrows the original threat model's escape hatch into a requirement. The
original Decision noted that "authors who need state-file confidentiality should
choose a locked-down state backend"; persisting real pre-release values makes
that **mandatory** for redaction-plus-codegen. The state backend now holds the
exact monetization metadata redaction hides from the Roblox page, so it must be
a confidential store (e.g. a private gist) — the same trust boundary the
backend already required for resource IDs, now load-bearing for display content
too. The on-Roblox threat model is unchanged: placeholders are still what ships
to Open Cloud. No state-file schema bump: `realDisplay` is an optional,
v1-compatible addition (see ADR-019's 2026-06-23 amendment); older readers
tolerate it and a happy-path (no redaction) file never carries it.
