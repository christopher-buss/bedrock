# Vendor Schemas

## Roblox OpenAPI Schema

**File:** `roblox-openapi.json`
**Upstream:** <https://github.com/Roblox/creator-docs/blob/main/content/en-us/reference/cloud/openapi.json>
**Pinned commit:** `1383cbec2a860aff931128445ff77609b790913f`
**Format:** OpenAPI 3.0.4 (JSON)

### Refresh

```sh
pnpm --filter @bedrock-rbx/ocale refresh-openapi
```

The script updates both `roblox-openapi.json` and the pinned commit
SHA in this README. After refreshing, diff the file against the
previous version to review changes before committing.

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

### Drift detection layers

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
