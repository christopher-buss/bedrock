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
	redacted?:
		| boolean
		| { description?: string; icon?: Record<"en-us", string>; name?: string };
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
