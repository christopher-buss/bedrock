# Config parity review validation

On 2026-10-26, a read-only reviewer applied the
[package parity policy](../../../packages/bedrock/CLAUDE.md#tsluau-config-parity-review)
to independent hypothetical PR changes against
`487bb7abed2daeb69c02c646a3a5070b396ffa28`. The reviewer read that policy, the
then-modified `/code-review` instructions, and ADR-025's checked-authoring and
repository-review amendments. These inputs were not applied to source files,
compiled, or executed. The observations test review guidance, not type-checker
behaviour or automatic standards discovery.

The local skill edit used for that run has since been reverted because the skill
is vendored. These observations establish how the supplied package checklist
guided review; they do not validate discovery through the unmodified skill. The
repository-owned CONTRIBUTING rule now supplies the checklist and report
requirement through the vendored skill's existing Standards sources.

## Missing Luau field

Input: add `saleLabel?: string` to TypeScript `GamePassEntry` only.

Observed: the reviewer flagged the missing optional string field in Luau's
`GamePassEntry` and `GamePassOverlay`, plus missing positive and wrong-type Luau
specs. This demonstrates the missing-on-Luau addition from
[#448](https://github.com/christopher-buss/bedrock/issues/448).

## Matching field and spec changes

Input: the same TypeScript addition, plus `saleLabel: string?` on both Luau
entry and overlay shapes. TypeScript's existing `Partial<GamePassEntry>`
inherits the overlay field; Luau's validator derives entry checks from the
changed shapes. The hypothetical PR includes:

- TypeScript property-type and Luau entry/overlay shape assertions.
- A positive public `defineConfig` case containing root and environment labels.
- Wrong-type negatives through `defineConfig` and `defineEnvironment`.

Redaction overrides are unchanged because this hypothetical field does not
participate in redaction. Deployment handling is outside this type-contract
exercise.

Observed: no parity finding within that scope. The reviewer explicitly left
passing type-test execution unverified.

## Private proof rename

Input: rename `ConfigProof`'s private `__bedrockConfig` property to
`__bedrockConfigChecked` in Luau only; change nothing else.

Observed: the reviewer accepted that proof encoding needs no TypeScript
counterpart, but identified a potential accepted-input regression:
`CheckedConfig` still exempts only the old proof key from unknown-field checks.
Revalidating a checked factory result could reject the renamed key. A consistent
internal update and regression evidence are needed. This is an incomplete
rename, so it is not a benign representation-only control.

## Universe identity guard change

Input: change `if rootAuthority and hasIdentity then` to
`if false and rootAuthority and hasIdentity then` in Luau's `checkEnvironment`;
leave types and specs unchanged.

Observed: the reviewer flagged acceptance of conflicting root and environment
IDs while TypeScript still rejects them. It cited the current policy's identity
rule and the existing universe-authority negative spec, rather than applying the
obsolete deferred-XOR exemption. The reviewer did not run that spec.

## Comment-only control

Input: reword the comment above `ConfigProof`, with no type or guard change.

Manual source inspection: no accepted input, field, or factory contract changes.
The policy's comment-only exception requires no mirrored TypeScript change.
Unlike the proof rename, this control has no dependent guard update.

## Limits and reproduction

These are observations from one reviewer run for the first four inputs and
manual inspection for the comment-only control. They establish neither a
deterministic automated parity gate nor repeated-run reliability.

To repeat the exercise, supply each input independently as a hypothetical PR
delta and read CONTRIBUTING during `/code-review` step 3. Follow its instruction
to include the package checklist in the Standards sources and reviewer brief,
then retain the required **TS/Luau parity** result. Evaluate supported authoring
contracts and spec evidence; merely changing both schema files is insufficient.

Primary sources: [schema](../../../packages/bedrock/src/core/schema.ts),
[Luau contracts and guards](../../../packages/bedrock/src/luau/config.luau),
[shape specs](../../../packages/bedrock/tests/luau-types/entry-shapes.spec-d.luau),
[identity specs](../../../packages/bedrock/tests/luau-types/universe-authority.spec-d.luau),
[checked-config specs](../../../packages/bedrock/tests/luau-types/checked-config.spec-d.luau),
and [review workflow](../../../.agents/skills/code-review/SKILL.md).
