# ADR-022: By-Domain Folder Layout for `@bedrock-rbx/ocale`

**Date:** 2026-04-30 **Status:** Accepted

Decision Makers: Maintainer
Tags: open-cloud, ocale, folder-layout, domains, resources, operations

## Context

`@bedrock-rbx/ocale` organizes wire-level code (request builders, response parsers, wire types, rate-limit metadata) inside Resource folders at `src/resources/<resource>/`. Each Resource folder owns its builders, parsers, and wire types directly.

This collapses when a single upstream Roblox Domain serves multiple Resources. `gameinternationalization.roblox.com` hosts localized icon, name, description, and name-description Operations for badges, developer products, game passes, and universes, all under the same URL family, parameterized by entity type. With the peer-folder layout, wire code must either be duplicated across four Resource folders or extracted to an ad-hoc shared module outside any established convention. Neither scales to the full Open Cloud surface, which the package explicitly targets (all Resources in Roblox's Features list).

Issue #293 (`refactor(ocale): consolidate experience-icon and experience-thumbnails under universes`) is the immediate trigger. `experience-icon` and `experience-thumbnails` are currently peer Resource folders but are not in Roblox's Features list. They are Operation Groups on the Universes Resource. Resolving #293 cleanly requires a layout convention for Operation Groups and for wire code shared across Resources.

ADR-011 established the simplified architecture for `@bedrock-rbx/ocale` and explicitly deferred folder layout: "Folder layout is the package's own concern and is not prescribed by this ADR... Each opting-out package is responsible for its own structure." This ADR fills that deferred slot.

The vocabulary used throughout (Domain, Resource, Operation, Operation Group, Wire) is defined in `packages/open-cloud/CONTEXT.md`.

## Decision

Organize wire-level code by upstream Roblox Domain. Resource folders become thin facades that import from Domain sub-trees and bind Operations to public methods or Operation Groups.

### Two-axis layout under `src/`

```text
src/
├── client/
├── errors/
├── internal/
│   ├── envelopes/
│   ├── errors/
│   └── pagination/
├── domains/
│   └── <domain>/<sub-tree>/
└── resources/
    └── <resource>/
```

`domains/` and `resources/` are siblings. Each has a single responsibility: `domains/` owns all wire code; `resources/` owns all public surface.

### Domain folder naming

Kebab-case, `.roblox.com` suffix dropped, gateway prefixes collapsed to the logical service name. `gameinternationalization.roblox.com` maps to `domains/game-internationalization/`. The `/cloud/v2/...` path tree on `apis.roblox.com` maps to `domains/cloud-v2/`. Each unique upstream URL prefix gets its own Domain folder.

### Sub-trees within a Domain are per-shape, not per-entity

Each sub-tree carries one upstream API shape. Where a shape is genuinely shared across entities, the sub-tree is the shared module, parameterized by entity. There is no `_shared/` folder; the sub-tree is the shared code.

Example: `BadgesClient.icon.upload(...)`, `DeveloperProductsClient.icon.upload(...)`, and `GamePassesClient.icon.upload(...)` all bind to `domains/game-internationalization/icons/builders.ts`, each passing its own `entityType`. `UniversesClient.icon.upload(...)` binds to `domains/game-internationalization/game-icon/builders.ts` because the universe URL path is distinct (`/game-icon/games/{gameId}/...` vs `/{entity}/{id}/icons/...`).

Where entities within a Domain have unique shapes (most of `cloud-v2`: universes, places, data stores, memory stores), the per-shape rule degenerates naturally to per-entity sub-trees.

### File layout inside a sub-tree

The maximal layout; files exist when they earn content, not as skeleton:

```text
domains/<domain>/<sub-tree>/
├── builders.ts
├── builders.spec.ts
├── parsers.ts
├── parsers.spec.ts
├── wire.ts
├── operations.ts
├── operations.spec.ts
└── types.ts
```

Wire types live in `wire.ts` and never escape past the parser. Public types (parsed shapes exposed to consumers) live in `types.ts` and are re-exported through the Resource barrel. A trivial sub-tree with one Operation returning 204 may collapse to `builders.ts` and `builders.spec.ts`.

### Resource folder

```text
resources/<resource>/
├── client.ts
├── client.example.spec.ts
└── index.ts
```

`client.ts` imports builders, parsers, and operation-limit constants from one or more Domain sub-trees and binds them via the existing `ResourceMethodSpec` machinery into flat methods or Operation Group sub-properties. No wire code lives in the Resource folder.

### Layering rule

Resources may depend on Domains and `internal/`. Domains may depend on `internal/`. Nothing depends on Resources.

### Shared code in `internal/`

Cross-Domain shapes that recur widely (response envelopes, error envelopes, pagination conventions) live under `internal/`. The specific shape of these helpers is provisional pending real consumer friction; see Implementation Notes.

### Test layout

Unit tests are co-located with wire code inside Domain sub-trees (`builders.spec.ts`, `parsers.spec.ts`, `operations.spec.ts`). Integration tests live at `tests/integration/resources/<resource>/` and exercise the public client surface end-to-end. This asymmetry is intentional: unit tests cover the Domain axis, integration tests cover the Resource axis.

## Consequences

### Positive

- New Operation using an existing wire shape costs ~5 lines (one import, one `ResourceMethodSpec`, one method definition) instead of ~80 lines of new builders, parsers, wire types, and spec files.
- Cross-Resource Operation mirroring costs zero wire work. Both `BadgesClient.listForUniverse(...)` and `universesClient.badges.list(...)` bind to the same builder; no duplication, no cross-Resource import.
- Schema-drift updates are scoped to one Domain sub-tree. When `pnpm refresh-openapi` lands a change to a `game-internationalization` endpoint, only `domains/game-internationalization/` changes; Resource bindings are untouched unless the new field needs surfacing.
- Locating wire code from a URL is mechanical: derive Domain from host/prefix, find sub-tree by path entity, open `builders.ts`. No grep required.
- `resources/<resource>/client.ts` is pure binding code. Readers see what methods exist and which Domain Operations back them; Wire types and rate-limit constants are out of frame.
- Adding a new Roblox Feature is bounded by Resource folder size (three files). Wire complexity stays in `domains/`.
- Unit test location and integration test location are both mechanical. "Is this builder tested?" goes to the builder's folder. "Is this client tested?" goes to `tests/integration/resources/<resource>/`.

### Negative

- Two-axis navigation for most changes. A bug fix may require finding the Domain sub-tree, fixing the wire code, and confirming the Resource binding. The peer-folder layout collapses this to one location.
- The shared `entityType` parameter creates coupling. If Roblox diverges an endpoint for one entity (extra field, different content-type behavior), the builder must grow a discriminated union or split. Per-entity sub-trees would absorb that divergence automatically.
- Schema drift can fool the per-shape rule. Two endpoints that are shape-equivalent in the vendored OpenAPI spec (Roblox keeps per-entity named types such as `GetBadgeIconResponse` and `GetDeveloperProductIconResponse` that are structurally equivalent today) may diverge at runtime. Per-shape sub-trees mask that divergence behind a single builder; per-entity folders would surface it as separate code paths from day one. Conformance tests catch some of this but not all.
- Reading `resources/<resource>/client.ts` no longer gives a self-contained picture of the client. The reader follows imports across Domain sub-trees to assemble the full behavior.
- Migration is increasingly irreversible. With 100+ Operations eventually spread across Domain sub-trees, reversing to peer-folder layout is a multi-month project. Cost compounds with every new Resource.
- Domain-naming edge cases will recur as Roblox renames or reorganizes Domains. Each occurrence requires a naming call (follow the rename, keep the historical folder, or both).
- `internal/envelopes/`, `internal/errors/`, and `internal/pagination/` are designed up front from a scan, not extracted from real friction. Some of this scaffolding may need reshaping or deletion after first real use.
- Source layout uses two axes (`domains/`, `resources/`); integration tests use only the Resource axis. Unit tests cover the Domain axis, integration tests cover the Resource axis.
- First-contributor onboarding is heavier. Understanding the Resource/Domain split, the per-shape sub-tree rule, the layering rule, and the cross-Domain `internal/` convention requires more reading than the current "one folder is one client" model.

## Implementation Notes

This ADR is Accepted before any code under `src/domains/` is written.

Issue #293 (`refactor(ocale): consolidate experience-icon and experience-thumbnails under universes`) is the first concrete migration under this layout. It establishes the `domains/game-internationalization/` Domain folder, the per-shape sub-trees for icon and thumbnail Operations, and the Operation Group bindings on `UniversesClient`. The two existing peer-folder Resources `experience-icon/` and `experience-thumbnails/` are removed; their wire code lives in `domains/game-internationalization/` after the migration.

A separate forthcoming issue performs the big-bang migration of the remaining peer-folder Resources (`places/`, `game-passes/`, `developer-products/`, `universes/`) into the by-Domain layout under the same convention. That migration is sequenced after #293 lands so the per-shape sub-tree convention is validated against one Domain (`game-internationalization`) before being applied across the package.

All Resources added after this ADR is Accepted follow the by-Domain layout from inception.

The initial shape of `internal/` after issue #293 lands is provisional. Empirical OpenAPI scan data identifies three candidate folders: `internal/envelopes/` (`ApiEmptyResponseModel` at 293 response slots across 126 paths; `ApiArrayResponse_*` at 161 across 80), `internal/errors/` (`ActionResult` at 27 / 7, `ProblemDetails` at 41 / 10, `ErrorResponse` at 38 / 10), and `internal/pagination/` (54 cursor-based endpoints, 24 pageToken-based, deliberately not unified). These are starting points; the shape will be refined or pruned as Resources actually consume them. Counts derived from `vendor/roblox-openapi.json` by enumerating path x verb x response x content-type tuples and grouping by referenced schema name.

## Alternatives Considered

### Status quo: peer-folder Resources own their wire code

**Rejected.** Does not scale to the full Open Cloud surface. Wire code must be duplicated once one upstream Domain serves multiple Resources. With at least four Resources already needing the icon shape, duplication compounds with every new Roblox Feature.

### Lazy extraction: keep peer-folder layout, extract when second consumer arrives

**Rejected.** The commitment to implement all Roblox Open Cloud APIs means the second, third, and fourth consumers are already in scope. "Wait until repetition forces it" does not apply when the repetition is declared.

### Sub-folders inside `resources/<entity>/` for issue #293 only

**Rejected.** Solves the immediate friction but not cross-Resource sharing. The badge icon Operation cannot live inside `resources/universes/icon/`; the same Operation cannot live in two Resource folders.

### Per-entity sub-trees inside Domain folders, with `_shared/` siblings

`domains/game-internationalization/badges/`, `/developer-products/`, `/game-passes/`, `/universes/`, plus `_shared/` for shape-equivalent helpers used by the three monetization entities.

**Rejected.** This layout is asymmetric in a way that signals "entity" is not the right primary axis for the wire layer. Inside `legacy-game-internationalization` (33 paths), 18 are parallel across badges, developer products, and game passes (icons, names, descriptions, name-description updates), with shape-equivalent request and response bodies; per-entity folders for those three entities would contain only thin delegates over `_shared/`. The remaining 15 paths are universe-specific (`game-icon`, `game-thumbnails` carousel, `name-description/games`, `source-language/games`, `supported-languages/games`); a per-entity universes folder would carry substantial unique content. The asymmetry between three thin entity folders and one fat universes folder shows the entity axis does not fit this Domain. Per-shape sub-trees handle both kinds uniformly: shared shapes get parameterized sub-trees consumed by multiple Resources; universe-specific Operations get their own per-shape sub-trees regardless of which entity owns them.

### Folder-per-literal-Roblox-subdomain (including `.roblox.com` suffix)

**Rejected.** Most of Roblox's current Open Cloud surface is served via `apis.roblox.com`, which would absorb nearly the entire wire layer into one folder while sibling Domain folders sat near-empty. Collapsing gateway prefixes to logical service names yields an even tree while preserving alignment with Roblox's Domain naming.

### Per-API-version sub-trees

Use the upstream URL version prefix as part of the Domain axis: `domains/legacy-game-internationalization-v1/`, `domains/cloud-v2/`, `domains/game-passes-v1/`. Each version of each Domain becomes its own folder.

**Rejected.** Roblox's "Domains" navigation does not surface API version as a primary axis; versions are an implementation detail of upstream URL paths. Folder names mirror Roblox's logical Domain names and absorb the version prefix where present (collapsing `legacy-game-internationalization-v1` to `game-internationalization`). If Roblox eventually publishes a breaking v2 of an existing Domain, that becomes a new Domain folder (`game-internationalization-v2`) at that point. Designing for the version axis up front would impose folder-name churn before any v2 exists.

### Generated code from the vendored OpenAPI spec

Use a code generator (OpenAPI Generator, openapi-typescript-codegen, or similar) to produce wire-level builders, parsers, and types directly from `vendor/roblox-openapi.json`.

**Rejected.** The vendored OpenAPI spec has known accuracy gaps documented in `packages/open-cloud/vendor/README.md` ("pinning the schema does not protect against behavior drift"). The SDK's job is to normalise upstream inconsistencies into a clean public API: snake_case becomes camelCase, `null`-bearing fields become `T | undefined`, error envelopes converge into one `OpenCloudError` discriminated union per ADR-009. Generated code would propagate upstream inconsistencies into public types and require post-generation patching more brittle than hand-writing the normalisation once. The wire-layer organisation decided here (Domain sub-trees) is the structural answer; manual builders and parsers within those sub-trees remain the implementation choice.

### Recursive Resource term at every nesting level (Stainless / OpenAI SDK style)

**Rejected.** "Resource" in this codebase is reserved for top-level entities mirroring Roblox's Features list 1:1 (per `packages/open-cloud/CONTEXT.md`). Recursive use forces every reference to qualify which Resource is meant. "Operation Group", taken from Azure SDK precedent, disambiguates cleanly.

### Amend ADR-011 rather than write a new ADR

**Rejected.** ADR-011 decided FCIS-vs-simplified architecture and explicitly punted folder layout to a later document. Folder layout is a separate concern; this ADR fills the deferred slot rather than retroactively expanding ADR-011's scope.

## Related Decisions

- **ADR-011**: Simplified Architecture for Library Packages. Establishes the simplified architecture for `@bedrock-rbx/ocale` and explicitly defers folder layout. This ADR fills that deferred slot. ADR-011 is not superseded.
- **ADR-012**: Class-Based Clients with Per-Request Config Overrides. The `ResourceMethodSpec` machinery referenced in the Decision is introduced there.
- **ADR-010**: SDK-Managed Rate Limiting and Retry. Operation rate-limit constants referenced in Domain sub-trees' `operations.ts` files are governed by that ADR.

## References

- [Roblox Open Cloud documentation](https://create.roblox.com/docs/cloud). Source of the Domain navigation and Features list that this ADR's vocabulary tracks.
- [Azure SDK guidelines for Operation Groups](https://azure.github.io/azure-sdk/general_design.html). Naming precedent for grouping related Operations under a Resource client property.
- [OpenAI Node.js SDK](https://github.com/openai/openai-node). Industry example of the recursive-Resource pattern rejected in Alternatives Considered.
- [Michael Nygard, "Documenting Architecture Decisions" (2011)](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions). Source of the append-only ADR convention.
- [MADR template](https://github.com/adr/madr). Canonical status vocabulary.
