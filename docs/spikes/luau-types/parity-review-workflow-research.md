# TS/Luau parity in PR review

This investigation recommends repository-owned parity policy consumed by
`/code-review`, updated for ADR-025's checked authoring API.

Researched 2026-10-26. Recommendation only: no policy, skill, issue, or review
automation is changed here.

Implementation follow-up: the
[package policy](../../../packages/bedrock/CLAUDE.md#tsluau-config-parity-review)
and [validation observations](./parity-review-validation.md) now implement this
recommendation. The investigation below records the proposal before that work.

## Current workflow and obsolete requirements

[#448](https://github.com/christopher-buss/bedrock/issues/448) proposes
extending `/review`: review changes in either schema, cover entry/override types
and future config exports, require type-spec evidence, and exempt deferred
universe-ID XOR checking. Its missing-field example remains useful; its
permissive-`Config` premise does not.

The current
[.agents/skills/code-review/SKILL.md](../../../.agents/skills/code-review/SKILL.md)
separates Standards from Spec. Standards discovers repository rules, such as
`CONTRIBUTING.md` or `CODING_STANDARDS.md`; their file list enters the reviewer
prompt alongside the smell baseline. Repository rules override that baseline.
[.agents/skills/implement/SKILL.md](../../../.agents/skills/implement/SKILL.md)
already invokes `/code-review` for completed work, including pending changes
when applicable. Neither skill currently contains a Bedrock parity rule. Durable
policy belongs among the standards supplied to that reviewer, rather than inside
the reusable skill.

[ADR-025's final amendment](../../adr/025-luau-type-definitions.md#amendment--2026-10-26-checked-authoring-types)
explicitly supersedes both the original permissive signature and the preceding
collection-checking limitation. `defineConfig` now checks original input types,
nested entries, unknown keys, required fields, unions, intersections, actual
indexers, and universe identity relationships. `Config<Actual>` and
`EnvironmentEntry<Actual>` require factory results; bare annotations are
obsolete. [Implementation](../../../packages/bedrock/src/luau/config.luau) and
[checked-config specs](../../../packages/bedrock/tests/luau-types/checked-config.spec-d.luau)
agree.

Consequently, #448's acceptance criterion excluding deferred XOR is obsolete.
Exclude differences in encoding and diagnostics, not missing identity
validation. Its `/review` wording should map to today's `/code-review` workflow.
Retain review-time parity enforcement: ADR-025 rejects an automated structural
diff; its historical rationale cites an asymmetry that has since narrowed.

## Recommended policy location

Prefer a focused **TS/Luau config parity** section in
[packages/bedrock/CLAUDE.md](../../../packages/bedrock/CLAUDE.md), linked from
[CONTRIBUTING.md](../../../CONTRIBUTING.md)'s existing rules section. The
package guide already owns architecture, public API discipline, and testing,
while [root CLAUDE.md](../../../CLAUDE.md) owns shared conventions. Explicitly
include the package guide among Standards sources and carry its parity checklist
into reviewer context; do not assume nested instructions are automatically
discovered.

Putting the complete rule in CONTRIBUTING is also compatible with Standards
discovery and human contributors, but places package-specific details in a
project-wide contribution guide. A new `CODING_STANDARDS.md` offers an obvious
discovery filename if standards are consolidated later; creating it for one rule
adds navigation and duplication. A standalone checklist has the same discovery
risk unless linked and supplied as a standards source. Keep one authoritative
rule with pointers elsewhere.

[.coderabbit.yaml](../../../.coderabbit.yaml) currently only excludes Renovate
from automatic review. CodeRabbit's
[Code Guidelines documentation](https://docs.coderabbit.ai/knowledge-base/code-guidelines)
says it automatically discovers `**/CLAUDE.md` and scopes each guide to its
directory and descendants. The existing package guide therefore offers a shared
policy source without duplicating the checklist in YAML. Confirm the applied
guidelines in CodeRabbit when validating the change; this investigation does not
verify live settings. Its
[path instructions](https://docs.coderabbit.ai/configuration/path-instructions)
are an optional supplement if reviews still miss the rule. A new
`CODING_STANDARDS.md` would need an additional guideline-file pattern for
CodeRabbit discovery.

## Proposed scope and review evidence

The prospective checklist should trigger on semantic authoring changes in either
direction:

- `packages/bedrock/src/core/schema.ts`: fields, names, types, optionality,
  entries, overlays, redaction overrides, root/environment settings, state, and
  identity rules.
- `packages/bedrock/src/luau/config.luau`: exported records/constants, shapes,
  checked type functions, factories, proof/result contracts, and identity/state
  guards. Validator-only changes can alter acceptance without changing a field
  list.
- `packages/bedrock/src/config.ts` and `src/shell/define-config.ts`: config
  exports and checked authoring rules, including plugin-dependent state.
  Classify future exports by supported config-data relevance; the barrel also
  exports TypeScript host APIs, so every export does not require a Luau
  namesake.

Compare supported accepted/rejected scenarios, not textual symmetry. Require
evidence covering affected entry shapes, overlays and overrides, public factory
calls, typed collections, and negative cases. Existing
[Luau specs](../../../packages/bedrock/tests/luau-types/) cover those
boundaries; TypeScript counterparts include `src/core/schema.spec-d.ts`,
`src/shell/define-config.spec-d.ts`, and `src/config.spec-d.ts`. Tests alone
cannot detect an unrepresented new field.

Hypothetical demonstration: add optional `saleLabel: string` to `GamePassEntry`
in TypeScript only. Review should flag the missing Luau entry/overlay field and
missing positive factory/shape coverage plus a wrong-type negative case. Update
redaction overrides only if the feature's semantics include redaction. A
comment-only schema edit is a negative control: inspect applicability, but
require no mirrored edit. An unchanged TypeScript union versus Luau
type-function encoding is another non-finding; newly accepting conflicting
root/environment IDs is drift.

Before marking #448 complete, run `/code-review` against fixed baselines for the
missing-field case, a fully mirrored field addition with specs, and an
intentional representation difference. Record the actual Standards findings and
confirm the package policy was supplied. These are proposed validation cases,
not review runs performed by this investigation. For applicable changes, the
policy should request a short parity-check result identifying the compared
contracts and spec evidence, or the reason verification is blocked; touching
both files alone is not evidence of parity.

Intentional differences remain explicit in the amendment: Luau `nil` cannot
represent present-`undefined`; `none`/`gistBackend` preserve singleton
inference; checked generics/proof fields differ from TypeScript annotations;
constituent records reject extra pretyped keys more strictly; JavaScript plugin
objects, callbacks, and Promises remain host APIs. Runtime identity availability
and key-format checks remain separate.
[Universe-authority specs](../../../packages/bedrock/tests/luau-types/universe-authority.spec-d.luau)
pin the union's subtle absent-root versus present-root behavior.

## Current verification commands

From repository root:

- `pnpm --filter @bedrock-rbx/core test:luau-types` runs
  `jest-roblox --typecheckOnly`; its pre-script copies assertion libraries. CI
  invokes it separately.
- `pnpm --filter @bedrock-rbx/core typecheck` runs `tsgo --noEmit`, including
  TypeScript type specs.
- `pnpm --filter @bedrock-rbx/core test --run tests/luau-types/config-types.spec.ts`
  checks setup-generated files with `lute check`; these Vitest cases skip
  without Lute.

Commands were inspected, not executed for this documentation-only investigation.

## Sources

- \[Scripts and runner]:
  [package scripts](../../../packages/bedrock/package.json),
  [type-spec selection](../../../packages/bedrock/jest.config.json),
  [fixture runner](../../../packages/bedrock/tests/luau-types/config-types.spec.ts).
- \[Toolchain and CI]: [Lute pin](../../../mise.toml),
  [CI command](../../../.github/workflows/ci.yaml).
- \[TypeScript contracts]:
  [schema](../../../packages/bedrock/src/core/schema.ts),
  [config exports](../../../packages/bedrock/src/config.ts),
  [authoring boundary](../../../packages/bedrock/src/shell/define-config.ts).
