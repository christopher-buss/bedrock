# Open Cloud Package

`@bedrock-rbx/ocale` is a typed HTTP client for Roblox's Open Cloud APIs. This context covers the vocabulary used to organise wire-level code, consumer-facing client classes, and the relationships between them.

## Language

**Domain**:
A Roblox subdomain that hosts a group of HTTP operations (`gameinternationalization.roblox.com`, `economy.roblox.com`, `apis.roblox.com`). Mirrors the "Domains" navigation in Roblox's Open Cloud documentation; the term is taken directly from there so internal code and Roblox docs share vocabulary.
_Avoid_: service, host, base URL

**Resource**:
A consumer-facing entity exposed as a single client class (`UniversesClient`, `BadgesClient`, `GamePassesClient`). The set of Resources tracks the canonical Features list in Roblox's Open Cloud documentation 1:1; new top-level Resources are not invented in this codebase, only mirrored from Roblox.
_Avoid_: feature, entity, sub-entity, kind

**Operation**:
The atom of the wire layer: one HTTP verb against one URL path, with its own builder, parser, wire types, and rate-limit metadata. Each Operation physically lives in exactly one **Domain** (single source of truth) and may be bound to methods on one or more **Resources**. Term taken from OpenAPI and from the existing `operationLimit` plumbing in `internal/resource-client.ts`.
_Avoid_: endpoint, action, API call

**Operation Group**:
A sub-namespace on a **Resource** client that groups related **Operations** under a property (e.g. `universesClient.icon.upload(...)`, `universesClient.badges.list(...)`). Pure ergonomic grouping; it shares the parent Resource's HTTP client, rate-limit queue, and per-request override surface. Term taken from Azure SDK conventions, where Operations grouped by shared context are called Operation Groups.
_Avoid_: facet, sub-client, namespace, subresource

**Wire**:
The raw JSON shape that crosses the HTTP boundary: Roblox's snake_case field names, `null`-bearing values, and unparsed numeric strings as they appear on request and response bodies, before parsers translate them into the camelCase, `T | undefined` shapes that **Resources** expose publicly. Wire types live in each Operation's `wire.ts` and never escape past the parser boundary.
_Avoid_: raw types, DTO, payload

**Rate-limit queue**:
The per-`(API key, Operation)` token bucket that paces every outbound request for one **Operation** down to that Operation's per-key ceiling, serialising concurrent callers. It is the layer that keeps traffic under Roblox's quota; a caller's own loop does not. The ceiling is sourced from `x-roblox-rate-limits.perApiKeyOwner` in the vendored schema, which the live `x-ratelimit-*` response headers are the authority on — trust those over the human-doc prose quota, which can be stale (Luau-execution `tasks.get` reads 200/min in both the schema and live headers, despite docs prose saying 45/min). Roblox enforces a fixed, clock-aligned 60s window; our token-bucket model is a deliberately conservative approximation, so `retry-after` on a 429 can lie (the real recovery is `x-ratelimit-reset`, the window boundary).
_Avoid_: throttle, debounce, rate limiter (when the per-key/per-Operation scoping matters)

**Retry backoff**:
The escalating delay before re-sending a single failed request that returned a retryable status (429/5xx), bounded by `maxRetries`, within one **Operation** call. Concerns one request's transient failure — not the spacing between distinct reads of a resource.
_Avoid_: poll cadence, rate limiting

**Poll cadence**:
The delay between successive reads of a long-running resource's state (today, a Luau execution task) while waiting for it to reach a terminal state. Governs latency-to-completion for short runs and, under concurrency, how much **Rate-limit queue** headroom a long run leaves for newer ones. A separate concern from **Retry backoff**: it spaces *distinct* reads, not retries of one read, and its curve is tuned to task lifetimes, not transient-failure recovery.
_Avoid_: retry, retry backoff, poll interval (when the distinction from retry matters)

## Relationships

- An **Operation** belongs to exactly one **Domain**.
- A **Resource** binds a method (or an **Operation Group** method) to one or more **Operations**.
- The same **Operation** may be bound by methods on multiple **Resources**. Roblox docs cross-reference one URL on multiple feature pages, and our public API mirrors that by re-exporting from the same wire source without duplicating the implementation.
- An **Operation Group** is always nested inside a single **Resource**; Operation Groups do not nest inside other Operation Groups.
- Whether to expose a given **Operation** as a flat method on a **Resource** or as part of an **Operation Group** is a per-Resource design decision driven by developer mental-model: group when the Operations naturally cluster (icon, thumbnails, badges-of-this-universe); leave flat when there's no cluster (`get`, `update`, `restartServers`).
- **Wire** types are an implementation detail of an **Operation**; they are consumed by builders and produced by parsers, but never appear on a **Resource**'s public surface.

## Example dialogue

> **Reviewer:** "Where does the wire code for `legacy-badges/v1/universes/{universeId}/badges` live?"
> **Maintainer:** "In the **apis.roblox.com** Domain. That's the upstream host; there's exactly one builder/parser pair for that **Operation**, regardless of how it gets exposed."
> **Reviewer:** "But I see it on both `BadgesClient.listForUniverse(...)` and `universesClient.badges.list(...)`."
> **Maintainer:** "Right. Both **Resources** bind methods to the same Operation. `BadgesClient` is the badge-centric Resource; `universesClient.badges` is an **Operation Group** on the Universes Resource that re-exports the universe-scoped badge Operations where consumers expect to find them. One Operation, two surface bindings."

## Flagged ambiguities

- **"Thumbnails"** is overloaded. Roblox's Features list has a top-level "Thumbnails" Feature covering generic thumbnail fetching for any asset, user, group, etc.; that is its own Resource (a future `ThumbnailsClient`). Separately, the universe-screenshot-carousel mutations (upload/reorder/delete on `gameinternationalization.roblox.com`) appear as the `thumbnails` Operation Group on the Universes Resource. When the term "thumbnails" appears in this codebase, the surrounding context (presence of `universesClient.thumbnails.*` vs. `ThumbnailsClient` instantiation) disambiguates.
- **"Localization"** has the same shape. Roblox's Features list has a top-level Localization Feature (translation tables, autotranslation): its own Resource. Localized name/description/icon mutations for badges, developer products, game passes, and universes (also routed through `gameinternationalization.roblox.com`) appear as `localization` Operation Groups on the relevant per-entity Resources.
