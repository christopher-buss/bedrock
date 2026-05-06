# Gist State Adapter Implementation Plan

**Goal:** Ship the default `StatePort` adapter, backing deploy state against a GitHub Gist. Unblocks a real-backend smoke test for `deploy()` and lays the pattern for future `@bedrock-rbx/s3` and `@bedrock-rbx/r2` adapters.

**Tracking:** [#101](https://github.com/christopher-buss/bedrock/issues/101). Follow-up: [#169](https://github.com/christopher-buss/bedrock/issues/169) (rewire the existing place-deploy smoke to use the new adapter).

**Delivery:** one PR titled `feat(core): add gist state adapter`. Commit granularity emerges from RED+GREEN per test, not pre-specified here.

---

## Context

`StatePort` and `BedrockState` are locked by [ADR-019](../adr/019-state-data-model-and-diff-algebra.md). `deploy()` already consumes a `StatePort` directly, so the adapter is the last piece between in-memory fakes and production-shaped state persistence. The archived [ADR-003](../adr/.archive/003-github-gists-state.md) established gists as the default backend; this plan implements that decision.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Scope is the adapter only. No bootstrap, no CLI, no config-schema plumbing. | Keeps the slice reviewable. Bootstrap and `bedrock init` depend on the pending CLI work ([#112](https://github.com/christopher-buss/bedrock/issues/112)). |
| 2 | Shared adapter work lives as pure helpers in `core/`, not as a base class or mixin. | `packages/bedrock/CLAUDE.md` bans factory classes. Shared logic keeps the pure/IO split ADR-018 mandates and prevents each third-party adapter from re-implementing the `$bedrock.version` guard (the exact ADR-019 data-loss scenario). |
| 3 | Single gist holds one file per environment (`state.<env>.json`). | Mirrors ADR-019's "one file per environment" wording. Aligns with S3/R2's "one bucket, one object per env" model so adapter factories stay symmetric. |
| 4 | Unsafe environment names are rejected at the adapter boundary with `StateError`. | Silent sanitisation would collide `prod` and `prod/`. Validation rule: letters, digits, `-`, `_`, length 1..64. |
| 5 | HTTP layer is native `fetch` with an injectable seam (`fetch?` on the deps). Defaults to `globalThis.fetch`. | Two endpoints do not warrant octokit or a shared HTTP layer. Injection matches ocale's `httpClient` pattern, keeps tests linear, and honours the zero-dependency posture of `@bedrock-rbx/core`. |
| 6 | Gist adapter ships bundled inside `@bedrock-rbx/core`. Future S3 and R2 adapters ship as `@bedrock-rbx/s3` and `@bedrock-rbx/r2`. | Gist is 80 LOC with zero runtime deps, so it belongs with the default. SDK-weight adapters stay opt-in installs. The cross-package pattern earns an ADR once the second adapter is actually being written. |
| 7 | Writes use single-file PATCH (`PATCH /gists/{id}` with one entry in `files`). No read-modify-write. No ETag. | GitHub PATCH is additive at the file level, so per-env writes cannot corrupt sibling envs. Gists do not support `If-Match`; concurrency belongs in [#122](https://github.com/christopher-buss/bedrock/issues/122). |
| 8 | Exported public API: `createGistStateAdapter`, `GistStateAdapterDeps`, `serializeStateFile`, `parseStateFile`, `validateEnvironmentName`. | The helpers are the plugin contract (ADR-017): third-party adapters compose them to inherit envelope, version-guard, brand re-validation, and env-name rules. |

## HTTP constants

Pinned values for the outgoing gist requests (verified against GitHub docs, 2026-04-24):

- `Authorization: Bearer <token>` (accepted for fine-grained PATs, classic PATs, and JWTs).
- `X-GitHub-Api-Version: 2026-03-10` (latest supported; `2022-11-28` remains the implicit default if the header is omitted).
- `User-Agent: bedrock/<package-version>` (missing UA returns 403).
- `Accept: application/vnd.github+json`.
- Base URL: `https://api.github.com`.
- No retry/backoff in this slice. GitHub's authenticated rate limit (5000 req/hr) leaves headroom for any realistic deploy cadence.

## Shapes

```ts
export interface GistStateAdapterDeps {
	/** Injection seam for tests. Leave undefined in production. */
	readonly fetch?: typeof globalThis.fetch;
	readonly gistId: string;
	readonly token: string;
}

export function createGistStateAdapter(deps: GistStateAdapterDeps): StatePort;

export function serializeStateFile(state: BedrockState): string;

export function parseStateFile(
	raw: string | undefined,
	file: string,
): Result<BedrockState | undefined, StateError>;

export function validateEnvironmentName(environment: string): Result<string, StateError>;
```

`serializeStateFile` writes the `$bedrock: { version: 1 }` envelope. `parseStateFile` takes `undefined` for "backend returned no bytes" and collapses it to `Ok(undefined)` so every adapter shares that branch.

## Error mapping

Every failure surfaces as `StateError`. The `file` field is set to `gist:<gistId>/state.<env>.json` so log grep works across adapters.

| Condition | `read` | `write` |
|---|---|---|
| 200, file present, size <= 1 MB, parses cleanly | `Ok(state)` | n/a |
| 200, file present, `truncated: true`, size <= 10 MB | follow `raw_url` | n/a |
| 200, file present, size > 10 MB (from `file.size`) | `Err` "state file too large: <N> bytes" | n/a |
| 200, file key absent from `files` dict | `Ok(undefined)` | n/a |
| 200, file present, malformed JSON or version guard rejects | `Err` via `parseStateFile` | n/a |
| 200 (write) | n/a | `Ok(undefined)` |
| 401 / 403 | `Err` "auth failed (<status>): check token scopes" | same |
| 404 on the whole gist | `Err` "gist <id> not found: check gistId" | same |
| 422 | n/a | `Err` "invalid PATCH body" (indicates a bedrock bug, not user input) |
| 5xx | `Err` "github returned <status>" | same |
| Network error (fetch throws) | `Err` "network error: <message>" | same |

First-write-to-a-new-env-file relies on PATCH's empirically-stable behaviour of creating a new file when the filename is new. That behaviour is not contractually documented by GitHub, so the E2E smoke test exercises it explicitly. If GitHub ever breaks the rule, the smoke fails loudly and the adapter can fall back to read-modify-write.

## File structure

**New files**

- `packages/bedrock/src/core/state-file.ts` (serializer + parser)
- `packages/bedrock/src/core/state-file.spec.ts`
- `packages/bedrock/src/core/state-file.example.spec.ts` (generated)
- `packages/bedrock/src/core/environment.ts` (`validateEnvironmentName`)
- `packages/bedrock/src/core/environment.spec.ts`
- `packages/bedrock/src/core/environment.example.spec.ts` (generated)
- `packages/bedrock/src/adapters/gist-state-adapter.ts`
- `packages/bedrock/src/adapters/gist-state-adapter.spec.ts`
- `packages/bedrock/src/adapters/gist-state-adapter.example.spec.ts` (generated)
- `apps/e2e/tests/smoke/state-gist.spec.ts`

**Modified files**

- `packages/bedrock/src/index.ts` (add the five new exports, with `@example` blocks on source symbols)

## Order of work

1. **Pure state-file helpers** (`serializeStateFile`, `parseStateFile`). No HTTP, no env rules.
2. **Environment-name validator** (`validateEnvironmentName`). Standalone pure helper.
3. **Gist adapter read path**. `createGistStateAdapter` factory returns `{ read }` only at this point.
4. **Gist adapter write path**. Widens the returned object to `{ read, write }`.
5. **E2E smoke** against a real gist.

Each step consumes the earlier ones. Commits emerge from the RED+GREEN loop inside each step; no pre-declared commit count.

## Testing

- **Unit (pure)**: state-file and environment tests reach 100% branch coverage via `it.for` tables. No I/O.
- **Unit (adapter)**: `gist-state-adapter.spec.ts` uses an injected fake `fetch`. Each test asserts the outgoing `Request` (URL, method, headers, body) and the returned `Result`. One table covers the error-mapping rows for `read`, another for `write`.
- **Integration**: `packages/bedrock/tests/integration/gist-state-adapter.spec.ts` runs stateful round-trip scenarios against an in-memory fake gist (fake `fetch` + a `Map<filename, content>`).
- **E2E smoke** (`apps/e2e/tests/smoke/state-gist.spec.ts`): `skipIf(!HAS_SECRETS)` gate on `GITHUB_TOKEN` + `BEDROCK_TEST_GIST_ID`. Sequence: write state for `smoke-<nanoid>`, read it back, assert round-trip equality, delete the file via PATCH with null content. The delete step keeps the fixture gist from accumulating stale env files across CI runs.

No `nock`. No recorded-fixture contract tests. The E2E smoke is the only tier that exercises the real GitHub contract.

## Public API surface (for the PR changelog)

- `createGistStateAdapter(deps: GistStateAdapterDeps): StatePort`
- `GistStateAdapterDeps` interface
- `serializeStateFile(state: BedrockState): string`
- `parseStateFile(raw: string | undefined, file: string): Result<BedrockState | undefined, StateError>`
- `validateEnvironmentName(environment: string): Result<string, StateError>`

Each lands with a JSDoc `@example` block, per ADR-005. `parseStateFile` carries two blocks (success and qualitatively different failure) because a single block cannot convey both legitimate-first-deploy and malformed-version behaviour.

## Out of scope

- **Bootstrap / first-deploy UX.** Creating the gist from within the adapter, writing the gist ID back to a config file, or a `bedrock init` command. Deferred to the CLI slice ([#112](https://github.com/christopher-buss/bedrock/issues/112)) and project-config plumbing.
- **Concurrency / state locking.** Tracked in [#122](https://github.com/christopher-buss/bedrock/issues/122). Gists do not support `If-Match`, so optimistic locking is not viable here anyway.
- **Retry and backoff.** Deferred until a concrete failure mode motivates it.
- **Large-state support above 10 MB.** The adapter hard-errors. Realistic Roblox deploys are orders of magnitude below the threshold.
- **S3 and R2 adapters.** Separate packages, separate issues, separate ADR when the pattern lands.

## Follow-up

- [#169](https://github.com/christopher-buss/bedrock/issues/169): replace the in-memory `StatePort` in `apps/e2e/tests/smoke/deploy-place.spec.ts` with `createGistStateAdapter`. Ships as a separate PR after this one lands.
- Adapter-packaging ADR: draft when `@bedrock-rbx/s3` starts. The cross-package pattern ("defaults in core, SDK-weight adapters as their own packages") is real but needs a second concrete case before it earns an ADR.

## Related decisions

- [ADR-017](../adr/017-product-framing-programmatic-iac-with-cli.md): `StatePort` is public API; third-party state adapters are a supported plugin surface.
- [ADR-018](../adr/018-fcis-ports-with-primary-driven-distinction.md): pure helpers in `core/`, HTTP glue in `adapters/`.
- [ADR-019](../adr/019-state-data-model-and-diff-algebra.md): the `BedrockState` shape, the `$bedrock.version` envelope, and the StatePort contract itself.
- [ADR-008](../adr/008-zero-runtime-dependencies.md): supply-chain posture that rules out octokit for this adapter.
- [ADR-003 (archived)](../adr/.archive/003-github-gists-state.md): original framing of gists as the default state backend.
