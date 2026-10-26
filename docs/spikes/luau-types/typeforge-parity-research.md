# TypeForge and Luau config parity

This note separates the Luau type-function capabilities needed for config parity
from the inference behavior that Bedrock must verify at its public API.

Researched on 2026-10-26. TypeForge source is pinned to commit
`342f53b327edf630ba2f031ae569c290daebfbf2`.

## What TypeForge demonstrates

TypeForge implements `Partial`, `DeepPartial`, `Required`, and `DeepRequired` by
transforming table properties and indexer values. Its traversal also handles
union and intersection components. The tests exercise named fields, nested
tables, indexers, unions, and intersections. These are useful patterns for
deriving Bedrock overlays from entry types rather than duplicating their field
lists.
[Implementation](https://github.com/typeforge-luau/typeforge/blob/342f53b327edf630ba2f031ae569c290daebfbf2/src/init.luau#L1987),
[tests](https://github.com/typeforge-luau/typeforge/blob/342f53b327edf630ba2f031ae569c290daebfbf2/src/init.test.luau#L1036).

The current exported functions do not include an `Exact`, config validator, or
exclusive-or helper. TypeForge supplies relevant building blocks; its source
does not itself establish that a particular Bedrock function signature preserves
enough information to validate a caller's literal. Its tests mostly apply
transforms to explicit type arguments and compare the results.
[Source](https://github.com/typeforge-luau/typeforge/blob/342f53b327edf630ba2f031ae569c290daebfbf2/src/init.luau),
[tests](https://github.com/typeforge-luau/typeforge/blob/342f53b327edf630ba2f031ae569c290daebfbf2/src/init.test.luau).

TypeForge's `Expect` calls ordinary `error(...)` when its comparison fails. Its
documentation deliberately shows the resulting type-function diagnostic.
Therefore, rejecting this mechanism because the message says a type function
errored is a diagnostic preference, not evidence that type-level validation is
unavailable.
[Implementation](https://github.com/typeforge-luau/typeforge/blob/342f53b327edf630ba2f031ae569c290daebfbf2/src/init.luau#L2543),
[documentation](https://typeforge.luau.page/docs/miscellaneous#expect).

## APIs available for a custom validator

Official Luau documentation describes type functions as analysis-time functions
operating on types. The type runtime exposes table properties, indexers, union
components, and constructors for new table and function types. It also exposes
`issubtypeof` for checking assignability. Errors raised inside a type function
become analysis diagnostics.
[Type functions](https://luau.org/types/type-functions/),
[type library](https://luau.org/types-library/),
[implemented subtype-check RFC](https://rfcs.luau.org/method-type-issubtypeof.html),
[error propagation RFC](https://rfcs.luau.org/user-defined-type-functions.html).

The implementation captures the actual argument type at `defineConfig`, then
passes it to a validator which walks its properties. This checks unknown keys,
nested resource entries, and root/environment universe-ID relationships without
requiring Luau to select a member of a predefined config union from the literal.
The permanent type specs exercise the public authoring boundary.

## Why the existing spike is insufficient to prove impossibility

The earlier [spike](./spike.luau) inspects an already homogeneous environment
map through `indexer()`. At that point it has no distinct per-environment
property types. It does not test whether a generic boundary can preserve an
inferred literal's named environment properties and inspect those instead.

Luau distinguishes exact unsealed tables from inexact sealed tables. Sealed
tables permit width subtyping, so an ordinary concrete table annotation is not
an excess-property check. A validator given the argument's actual type can
inspect available property names; applying a transform only to the already
widened `Config` cannot recover names that widening discarded.
[Official table-type documentation](https://luau.org/types/tables/).

The issue linked by ADR-025, luau-lang/luau#2205, reports a generic string
literal being inferred as `string` in an `index<...>` call. It is relevant to
inference, but its reported example does not establish that all config
exclusive-or encodings are impossible.
[Upstream issue](https://github.com/luau-lang/luau/issues/2205).

## Meaning of exact parity

Bedrock should compare accepted and rejected authoring scenarios, not require
identical type-system machinery or diagnostic wording. Candidate encodings must
retain the existing `defineConfig({...})` call, optional collections, legitimate
environment overlays, and useful field access on the return value. They must
also fail the same invalid entry, unknown-key, and universe-ID scenarios without
casts or required empty maps. This is the proposed test criterion for the
investigation, not a claim that TypeForge already supplies the result.

One distinction needs a language-level interpretation: Luau tables cannot store
`nil` as a present value; assigning `nil` removes the key. Consequently,
TypeScript's distinction between a missing property and a present property whose
value is `undefined` cannot be copied literally into Luau table values.
Equivalent Bedrock behavior should define omission and clearing in terms of the
existing `$none` sentinel.
[Roblox table documentation](https://create.roblox.com/docs/luau/tables#remove-key-value-pairs).

## Initial executable investigation

Probes ran on `1.0.1-nightly.20261021`, using the actual exported Bedrock entry
shapes as the expected schema. The initial successful candidate captured the
caller's type before validating it:

```luau
local function defineConfig<T>(config: T & Context<Config> & Validate<T, Config>): T
    return config
end
```

`Context` recursively gives schema properties read-only types for contextual
inference. Its map indexers use ordinary `setindexer`, because the pinned Lute
build exposes `setreadindexer` but rejects it at evaluation time. The returned
`T` is the caller's original type; the helper does not freeze runtime tables.
`Validate` walks the actual properties and indexers, checks required fields,
checks primitive assignability with `issubtypeof`, rejects unknown fields, and
checks root/environment universe-ID conflicts. It returns the original type on
success and raises an analysis diagnostic on failure. These observations are
local probe results, not claims made by TypeForge.

The initial literal-call matrix produced the expected result in all 24 cases:

| Cases                                                                                                                                                                                                                                                                                                                | Result   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 9 valid configs: minimal, full, per-environment IDs, shared root settings with per-environment IDs, root ID with overlay metadata, environment-only state, multiple entries, `$none` clearing, and empty/omitted collections                                                                                         | Accepted |
| 15 invalid configs: root/environment unknown keys, unknown entry fields, missing environments, missing pass name, incorrect pass/product prices, incorrect place size, missing overlay identity, malformed social link/redaction, `$none` on a boolean, and root/environment ID conflicts in either environment slot | Rejected |

The negative runs were checked for syntax errors and errors in the helper
itself, so those failures are not being counted as validation successes.

Other signatures exposed narrower problems. `T & Validate<T, Config>` checks
keys and nested entries but widens `$none` to `string` in the full-config case,
rejecting a valid config. Adding the mutable `Config` directly brings back
invariance diagnostics on valid configs. A recursive read-only property context
avoided both problems in the tested cases. This is evidence for an improved
encoding, not a reason to require authors to annotate every entry or add a
discriminator to their config.

The 24-case probe established that the earlier blanket impossibility claim was
too strong. It did not establish parity for typed maps or unions. Extending the
probe found a valid typed environment map rejected by the same contextual
signature: a mutable map with a narrower declared entry type is not invariant
with the broad contextual map. Overloads lost the singleton context for valid
`"$none"` literals; an argument-aware context reduced after those literals had
already widened to `string`.

## Final checked authoring boundaries

The contextual prototype above was rejected after review. A real caller map
could have the same readonly indexer as the synthesized context; skipping the
indexer when named properties were present admitted conflicting IDs. Context
also widened supplied identities to optional fields, admitting uncertain root
IDs and later removal of a required ID. The final production factories validate
original argument types without that context, inspect every real indexer, and
classify nil-only intersections semantically.

Use `defineConfig` for literal or already-typed config values. Use
`defineEnvironment` when checking an environment separately before composing a
config. Both are identity functions at runtime. Their analysis-time argument
guards check original fields, required entries, unions, intersections, and
backend/identity rules. Use the typed constants `none` and `gistBackend` to
avoid singleton literals widening to `string` in generic calls:

```luau
--!strict
local bedrock = require("@bedrock/config")

return bedrock.defineConfig({
    environments = { production = {} },
    state = { backend = bedrock.gistBackend, gistId = "abc" },
    products = {
        gems = { name = "Gems", description = "Gem pack", price = bedrock.none },
    },
})
```

The constants retain the existing `"$none"` and `"gist"` string values. Raw
literals remain accepted by concrete constituent types where appropriate;
unconstrained factory calls should use the constants. No wire representation or
runtime clearing behavior changes.

The generic `Config<Actual>` and `EnvironmentEntry<Actual>` names describe
checked factory results. Their required private never-valued proof fields reject
raw initializers, including a valid-looking annotation whose optional map could
otherwise hide a wrong-typed entry. A trusted internal result assertion attaches
the type-only proof after argument validation. No `any` occurs in exported
signatures, and no runtime marker or metatable mutation is performed.

```luau
--!strict
local bedrock = require("@bedrock/config")

type Environment = { universe: { universeId: string } }
local environments: { [string]: Environment } = {
    production = { universe = { universeId = "123" } },
}
local value = { environments = environments }
local checked: bedrock.Config<typeof(value)> = bedrock.defineConfig(value)

local overlay = { passes = { vip = { price = bedrock.none } } }
local environment: bedrock.EnvironmentEntry<typeof(overlay)> =
    bedrock.defineEnvironment(overlay)

return checked
```

The type argument names the value being checked; it is not reflection over an
unrelated initializer. Factories are required for both checked result aliases,
so even a broad type argument cannot make an ordinary raw table into a checked
result. Existing bare annotations must migrate to the factories or the explicit
factory-backed forms above.

Closed resource, overlay, redaction, and fixed-locale records reject extra keys
before an annotation can erase them. Such closure is stricter than TypeScript
width subtyping on existing variables: an overlay carrying `placeId` is not a
root `PlaceEntry`. Field-shape and identity requirements are tested separately.

No or empty plugins select exact authored Gist state (`backend`, required
`gistId`, optional `locking`) at root and environment scope. String module
specifiers permit custom backends and keys. The loaded `StateConfig` shape
remains open like TypeScript `Config`; plugin-specific runtime validation still
belongs to the plugin.

The authority validator follows the actual TypeScript union, including the
absent-root metadata-only case. It rejects a possible-but-not-definite root ID,
conflicting IDs in indexed maps, and invalid union/intersection members. The
source proof does not weaken original map field types: string-to-number misuse
and whole-value misuse remain type errors, and known mutable fields retain their
types. Revalidation recognizes only the exact private proof keys with
uninhabited types.

Permanent cases live in
[`tests/luau-types`](../../../packages/bedrock/tests/luau-types/), especially
`checked-config`, `sound-authoring`, `state-config`, and `universe-authority`.
They cover the reviewed escapes, raw proof forgery, result-annotation input
checking, field precision, mutation, and valid authoring cases. Final repository
verification is recorded separately from this source-research note.

The supported surface is config-data authoring. JavaScript plugin declaration
objects, config callbacks, and Promise inputs remain TypeScript host APIs.
Luau's `nil` interpretation is described above. The later 2026-10-26 amendment
to [ADR-025](../../adr/025-luau-type-definitions.md) records the checked factory
contract and minor-version migration. No TypeForge dependency was added.

## Sources

- \[TypeForge]:
  <https://github.com/typeforge-luau/typeforge/tree/342f53b327edf630ba2f031ae569c290daebfbf2>
- \[Type functions]: <https://luau.org/types/type-functions/>
- \[Type function library]: <https://luau.org/types-library/>
- \[User-defined type functions RFC]:
  <https://rfcs.luau.org/user-defined-type-functions.html>
- \[Subtype method RFC]: <https://rfcs.luau.org/method-type-issubtypeof.html>
- \[Table types]: <https://luau.org/types/tables/>
- \[Literal inference issue]: <https://github.com/luau-lang/luau/issues/2205>
- \[Roblox tables]: <https://create.roblox.com/docs/luau/tables>
