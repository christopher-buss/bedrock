# Vendor Schemas

## Roblox OpenAPI Schema

**File:** `roblox-openapi.json`
**Upstream:** <https://github.com/Roblox/creator-docs/blob/main/content/en-us/reference/cloud/openapi.json>
**Pinned commit:** `b032c6ba6763d57ace62e0a04b3b48650f50fbab`
**Format:** OpenAPI 3.0.4 (JSON)

### Refresh

```sh
pnpm --filter @bedrock-rbx/ocale refresh-openapi
```

The script updates both `roblox-openapi.json` and the pinned commit
SHA in this README, then re-applies the local drift patches listed
below. After refreshing, diff the file against the previous version
to review changes before committing.

### Local drift patches

`scripts/apply-schema-patches.ts` corrects confirmed divergences
between the upstream schema and the live APIs at `apis.roblox.com`
and `develop.roblox.com`.
The script runs automatically as part of `refresh-openapi`. Each
patch is idempotent against an already-patched file (re-runs on the
same vendored copy are a no-op), but the refresh flow first calls
`verifyPatchesStillNeeded` against the freshly-pulled upstream and
fails loudly if any patch's pre-patch shape is absent, or if applying
the patch would repeat a key the object already has (Roblox shipped
the fix at a position the patch's regex does not look at). That signal
catches the case where Roblox has fixed a drift upstream: the patch
becomes obsolete and should be removed before the refresh succeeds.

Active patches as of 2026-11-09:

1. `components.schemas.MemoryStoreQueueItem.required` includes
   `"data"`. The server returns 400 `INVALID_ARGUMENT` when the
   field is absent or `null`; the schema marks it optional.
2. `components.schemas.MemoryStoreQueueItem.properties.path.readOnly`
   is `true`. The server generates the path on creation and silently
   ignores any client-supplied `path` in the request body (no
   validation, no error — the response always carries the
   server-generated value). The schema does not flag the field as
   read-only, so without this patch a fixture or builder could ship
   `path` in a request body and the test surface would not catch the
   bug. Verified 2026-05-14 via
   `scripts/probe-memory-store-queues.ts`.
3. `components.schemas["Roblox.GameInternationalization.Api.GetGameIconResponse"].properties.imageId`
   is `nullable`. The icon list sends `"imageId": null` for a
   locale still on the default icon; the schema types it as a plain
   string. Verified 2026-10-24 against
   `GET /legacy-game-internationalization/v1/game-icon/games/{gameId}`.
4. `components.schemas["Roblox.Web.Responses.RelatedEntityTypeResponse_Roblox.Platform.Badges.BadgeAwarderType_"].properties.type`
   is the string enum `["Place"]`. The badge create response sends
   `"type": "Place"`; the schema declares the integer enum `[1]`.
   Verified 2026-10-24 against
   `POST /legacy-badges/v1/universes/{universeId}/badges`.
5. The `Places_CreatePlaceVersionApiKey` success response declares
   `application/json` with an object containing a required numeric
   `versionNumber`. Upstream only declares a `text/plain` string with
   a JSON example. The server returned HTTP 200 with
   `Content-Type: application/json; charset=utf-8` and
   `{"versionNumber":6}` on 2026-10-26 at 00:04:06.934Z from
   `POST /universes/v1/{universeId}/places/{placeId}/versions?versionType=Published`.
   The authorized capture published `apps/e2e/tests/smoke/fixtures/place.rbxlx`
   to the existing root place in the Bedrock-only test universe;
   `tests/fixtures/places/publish-response.json` and its provenance
   preserve the body, timestamp and hashes. The patch retains the
   documented `text/plain` alternative and changes no version-history
   schema or parser. Conformance validates the decoded capture directly.
6. `components.schemas["Roblox.Web.WebAPI.Models.ApiPageResponse_Roblox.Badges.Api.BadgeResponse_"].properties`
   `previousPageCursor` and `nextPageCursor` are `nullable`. The badge
   list sends `"nextPageCursor": null` on the last page and
   `"previousPageCursor": null` on the first; the schema types both as
   plain strings. Verified 2026-11-09 with unauthenticated requests (no
   credential, no cookie) to
   `GET https://badges.roblox.com/v1/universes/{universeId}/badges`;
   `tests/fixtures/badges/list-page-2-response.json` keeps the body.
7. `components.schemas["Roblox.Api.Develop.Models.IPlaceModel"]` declares
   the required properties `id`, `universeId` (int64), `name` and
   `description` (string). The server sends all four on every item;
   upstream declares an empty object with `additionalProperties: false`.
   Verified 2026-11-09 without a credential against
   `GET https://develop.roblox.com/v1/universes/{universeId}/places`
   (`tests/fixtures/places/list-response-*.json`).
8. `previousPageCursor` and `nextPageCursor` on
   `Roblox.Web.WebAPI.Models.ApiPageResponse_Roblox.Api.Develop.Models.IPlaceModel_`
   are `nullable`. The server sends `null` at the first and last page;
   upstream types both as plain strings. Verified with the same capture
   as patch 7.

When a patched section is fixed upstream, the next `refresh-openapi`
will fail with the obsolete patch's description. Remove the
corresponding case from `apply-schema-patches.ts` and re-run the
refresh; the upstream value is then left in place.

### Why pin? And why pinning is not protection

The schema is committed at a known point-in-time so that:

- Builds are reproducible without network access
- Schema drift is visible in git diff
- CI does not depend on upstream availability

However, pinning the schema does not protect against behavior drift.
The Roblox API can change its runtime behavior without updating the
published schema, and the schema can be updated without changing
behavior. The pinned file is a reference, not a contract. Conformance
tests (in `tests/conformance/`) are the real protection against
behavioral drift; the vendor schema only provides the vocabulary.

## Roblox Creator Locales

**File:** `roblox-creator-locales.json`
**Upstream:** <https://locale.roblox.com/v1/locales/supported-locales-for-creators>
**Pinned date:** `2026-05-07`
**Format:** Raw upstream payload (JSON)

The companion file `../src/locales/data.generated.ts` derives the
`ROBLOX_CREATOR_LOCALES` const and the `RobloxLocale` /
`RobloxLanguageCode` union types from this snapshot. Both files are
regenerated together by the refresh script and committed to git.

### Refresh

```sh
pnpm --filter @bedrock-rbx/ocale refresh-locales
```

The script writes both the JSON and the generated TS module, and
updates the pinned date in this README. After refreshing, diff both
files against the previous version to review additions or
removals before committing.

### Why pin?

The locale list rarely changes (Roblox adds a region a few times a
year), but pinning the snapshot keeps `ROBLOX_CREATOR_LOCALES`
deterministic across builds and gives review surface to additions or
removals. Conformance tests under `tests/conformance/` keep the JSON
and the generated TS in sync.

## Drift detection layers

Drift is caught in three places, each with a different failure mode:

1. **Build-time (active).** Ajv-based conformance tests under
   `tests/conformance/` validate every hand-crafted fixture against the
   pinned schema, and the `FakeHttpClient` in `tests/helpers/` runs
   every integration-test request and response body through the same
   spec. If a fixture, parser, or builder drifts from the schema, CI
   fails on the next `pnpm test` run.
2. **Scheduled (active).** The `openapi-drift` workflow in
   `.github/workflows/` runs weekly, re-runs `scripts/fetch-openapi.ts`,
   and opens (or updates) a PR when the upstream `openapi.json` or its
   pinned commit SHA has diverged. Normal CI on that PR surfaces any
   fixture or parser drift introduced by the new spec. The refresh
   itself fails loudly via `verifyPatchesStillNeeded` when an
   upstream change has removed the pre-patch shape of one of the
   active drift patches; the message names the obsolete patch so the
   case can be removed before the refresh re-runs.
3. **End-to-end (deferred).** Scenario tests that hit the real Open
   Cloud API with throwaway resources will catch runtime behavior that
   the schema cannot describe (e.g. silent field rename, changed error
   semantics). Not yet implemented.
4. **Manual probes (on demand).** Per-resource scripts under
   `scripts/probe-*.ts` hit the live API without going through the
   SDK and print every request/response so the operator has direct
   evidence of the wire shape. Use them to investigate a suspected
   drift or to regenerate the fixtures under `tests/fixtures/`. The
   scripts require an API key and a throwaway universe; see each
   script's header comment for the env-var contract.
