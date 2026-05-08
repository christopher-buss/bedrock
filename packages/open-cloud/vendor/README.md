# Vendor Schemas

## Roblox OpenAPI Schema

**File:** `roblox-openapi.json`
**Upstream:** <https://github.com/Roblox/creator-docs/blob/main/content/en-us/reference/cloud/openapi.json>
**Pinned commit:** `0cbea0571b465d97ce870109666d6435e1491449`
**Format:** OpenAPI 3.0.4 (JSON)

### Refresh

```sh
pnpm --filter @bedrock/ocale refresh-openapi
```

The script updates both `roblox-openapi.json` and the pinned commit
SHA in this README, then re-applies the local drift patches listed
below. After refreshing, diff the file against the previous version
to review changes before committing.

### Local drift patches

`scripts/apply-schema-patches.ts` corrects confirmed divergences
between the upstream schema and the live API at `apis.roblox.com`.
The script runs automatically as part of `refresh-openapi` and is
idempotent: each patch is a no-op when the target shape is already
present, so refreshing against an upstream that has fixed a drift
will leave that section untouched.

Active patches as of 2026-05-08:

1. `components.schemas.MemoryStoreQueueItem.required` includes
   `"data"`. The server returns 400 `INVALID_ARGUMENT` when the
   field is absent or `null`; the schema marks it optional.
2. `components.schemas.MemoryStoreQueueItem.properties.path.readOnly`
   is `true`. The server generates the path on creation and
   rejects client-supplied paths; the schema does not flag the
   field as read-only.
3. `components.schemas.ReadMemoryStoreQueueItemsResponse.properties`
   uses keys `queueItems` and `id`. The server emits the items
   array under `queueItems` (schema: `items`) and the read
   identifier under `id` (schema: `readId`). The
   `DiscardMemoryStoreQueueItemsRequest` body is *not* affected;
   the discard request expects `readId`, matching the schema.
4. `components.schemas.MemoryStoreQueueItem.properties.ttl` drops
   `"format": "duration"`. The schema's example shows `"3s"`
   (Google's protobuf `Duration` style), which is the format the
   server actually accepts; the `format: "duration"` annotation
   makes Ajv-formats demand ISO 8601 (`PT3S`) instead and rejects
   wire-correct values during conformance validation.

When a patched section is fixed upstream, remove the corresponding
case from `apply-schema-patches.ts`. The next refresh will then
leave the upstream value in place.

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
pnpm --filter @bedrock/ocale refresh-locales
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
   fixture or parser drift introduced by the new spec.
3. **End-to-end (deferred).** Scenario tests that hit the real Open
   Cloud API with throwaway resources will catch runtime behavior that
   the schema cannot describe (e.g. silent field rename, changed error
   semantics). Not yet implemented.
