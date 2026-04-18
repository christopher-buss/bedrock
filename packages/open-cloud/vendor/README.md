# Vendor Schemas

## Roblox OpenAPI Schema

**File:** `roblox-openapi.json`
**Upstream:** <https://github.com/Roblox/creator-docs/blob/main/content/en-us/reference/cloud/openapi.json>
**Pinned commit:** `8757e0f1fcc2c1e31c13e01333a333134f165905`
**Format:** OpenAPI 3.0.4 (JSON)

### Refresh

```sh
cd packages/open-cloud
bun scripts/fetch-openapi.ts
```

After refreshing, diff the file against the previous version to review
changes before committing.

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
   pinned schema. If a fixture and the schema disagree, CI fails on the
   next `pnpm test` run. This is the only layer currently wired up.
2. **Scheduled (deferred).** A future CI job will periodically diff the
   upstream `openapi.json` against the pinned copy and open a PR when
   they diverge, so schema drift is visible without waiting for a
   contributor to notice. Not yet implemented.
3. **End-to-end (deferred).** Scenario tests that hit the real Open
   Cloud API with throwaway resources will catch runtime behavior that
   the schema cannot describe (e.g. silent field rename, changed error
   semantics). Not yet implemented.
