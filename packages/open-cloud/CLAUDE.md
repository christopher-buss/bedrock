# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Package Overview

`@bedrock-rbx/ocale` is a standalone TypeScript HTTP client for Roblox Open
Cloud APIs. It is designed to be publishable to npm and usable independently of
the Bedrock CLI.

Key characteristics:

- Zero runtime dependencies
- Class-based clients with immutable configuration
- Result types (no exceptions) for explicit error handling
- Subpath exports for optimal tree-shaking
- 100% test coverage requirement
- Dual runtime support: Node.js LTS (24.12+) and Bun 1.3+

The Roblox OpenAPI schema is vendored at `vendor/roblox-openapi.json`; refresh
it via `scripts/fetch-openapi.ts` when upstream changes require it.

## Design Principles

### 1. Result Types Over Exceptions

All client methods return `Promise<Result<T, OpenCloudError>>`:

```typescript
const result = await client.create(params);
if (!result.success) {
	// Handle error explicitly
	console.error(result.err.message);
	return;
}

// TypeScript knows result.data exists here
console.log(result.data.id);
```

### 2. Per-Request Configuration Override

Clients support per-request config overrides (Stainless SDK pattern):

```typescript
const client = new GamePassesClient({ apiKey: "main-key" });

// Override for this request only
const result = await client.create(params, {
	apiKey: "asset-upload-key", // Different key for moderation safety
	timeout: 60000,
});
```

### 3. Subpath Exports (No Barrel Files)

Import from subpaths, not the root:

```typescript
// Root export only exposes shared utilities
import { RateLimitError, type Result } from "@bedrock-rbx/ocale";
// Resource clients live on subpaths
import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";
```

The root `@bedrock-rbx/ocale` entry point deliberately does not re-export
resource clients; consumers pay only for the services they import.

### 4. Rate Limiting and Retries Built-In

The SDK manages concurrency, rate limiting, and retries internally. Consumers
fire requests and the SDK queues them. Pacing is **header-primed**: a budget
gate scoped to each API key and operation reads `x-ratelimit-remaining`/`-reset`
off every response and spaces requests across that operation's live window
(holding until reset once the budget is spent), self-correcting when the
server's real limit differs from the schema. A static per-operation token bucket
sourced from the vendored OpenAPI schema remains the cold-start and
header-absent fallback. Retries are idempotency-aware:

| Operation      | 429 (Rate Limit) | 5xx (Server Error) | Never reached Open Cloud |
| -------------- | ---------------- | ------------------ | ------------------------ |
| Create         | Retry            | Do not retry       | Do not retry             |
| Upload (place) | Retry            | Do not retry       | Retry                    |
| Read/List      | Retry            | Retry              | Retry                    |
| Update         | Retry            | Retry              | Retry                    |
| Delete         | Retry            | Retry              | Retry                    |

Create operations only retry rate limits to prevent duplicate resources (Roblox
does not support idempotency keys).

A 2xx whose body will not parse as JSON is retried on read/list/update/delete
only. It is classified by the synthetic `RESPONSE_UNPARSEABLE` code rather than
by its status (a 200 is in no status allowlist), and the usual grounds do not
apply: a 200 proves the request was processed, so only operations that are safe
to repeat re-issue it. See ADR-010's 2026-08-17 amendment.

"Never reached Open Cloud" covers transient transport failures and responses
served by an edge gateway rather than the API (`ApiError.gatewaySummary`,
classified by the synthetic `GATEWAY_REJECTED` transport code). Place uploads
retry these: a request that was never seen cannot have created a version, and
Roblox dedupes identical place content.

Separately, the transport sends `connection: close` on every upload request
(`isUploadRequest`, the same predicate that drops the default timeout), because
the keep-alive reuse race against Roblox's gateway is what produces those
failures in the first place. That header is meaningless under HTTP/2, which Node
26 negotiates by default, so uploads also carry a dispatcher that pins HTTP/1.1
— built from the runtime's own global dispatcher rather than an undici import,
and skipped entirely when no such global exists (Bun). See ADR-010's 2026-07-31
amendment.

See [ADR-010](../../docs/adr/010-sdk-managed-rate-limiting-and-retry.md) for the
implemented contract, including per-operation token buckets, the send-callback
wiring between queue and retry, and the `onRequest` / `onRetry` / `onRateLimit`
hook semantics.

## Testing Requirements

Every line of production code must be written in response to a failing test. For
the full RED → GREEN → REFACTOR commit cadence and the 100% coverage
requirement, see the root [CLAUDE.md](../../CLAUDE.md) and
[ADR-003](../../docs/adr/003-testing-strategy.md).

Unit tests live alongside their subject as colocated `*.spec.ts` files.
Integration tests live in `tests/integration/` and inject fakes for the two test
seams on `OpenCloudClientOptions`:

- `httpClient`: swap the fetch-backed transport for a recorded fake. Canonical
  fakes are
  [tests/helpers/fake-http-client.ts](tests/helpers/fake-http-client.ts) and the
  simpler [tests/helpers/fake-send.ts](tests/helpers/fake-send.ts) for
  single-call tests.
- `sleep`: swap the `setTimeout`-backed sleep for
  [tests/helpers/fake-sleep.ts](tests/helpers/fake-sleep.ts) so retry and
  rate-limit timing is deterministic.

Use a function reference in `describe()` so tests track renames:

```typescript
describe(buildCreateRequest, () => {
	it("should build request with required fields", () => {
		// Test pure function
	});
});
```

### Writable-keys conformance pins

Update and create operations whose request body is a JSON `$ref` to a component
schema shared with the response (Roblox's pattern for most `Cloud_Update*`
operations) must add a writable-keys pin under `tests/conformance/`. The spec
relies on `readOnly: true` to flag fields the server silently drops from PATCH
bodies, and the pin keeps the parameter interface and the spec in sync at
typecheck and test time.

Templates:
[tests/conformance/universes-writable-keys.spec.ts](tests/conformance/universes-writable-keys.spec.ts)
and
[tests/conformance/places-writable-keys.spec.ts](tests/conformance/places-writable-keys.spec.ts).

Each pin:

1. Declares a const array of writable keys (`as const`).
2. Asserts at module scope that the array equals the parameter interface keys
   minus the URL fields, via `expectTypeOf<...>().toEqualTypeOf<...>()`.
3. Asserts at test time that every entry is non-readOnly on the named OpenAPI
   schema, via `it.for(KEYS)(... listWritablePropertyNames("X") ...)`.

The pin does not apply to `multipart/form-data` bodies (developer-products,
game-passes); those use request-only inline schemas with no `readOnly` flags.

### Rate-limit conformance pins

An operation's `OperationLimit` is sourced from
`x-roblox-rate-limits.perApiKeyOwner` on **that operation**, never on a sibling
that shares a resource or a URL prefix. Two shapes of the same call can be
metered in separate buckets at different ceilings: the Luau Execution submit
endpoints are 40/minute at head and 5/minute version-pinned.

New operations add a row to a rate-limit pin under `tests/conformance/`, so the
limit fails the suite if it drifts from the vendored schema or is sourced from
the wrong operation. Template:
[tests/conformance/luau-execution-rate-limits.spec.ts](tests/conformance/luau-execution-rate-limits.spec.ts).

Each pin maps an `operationId` to the spec that calls it and asserts
`spec.operationLimit.maxPerSecond` equals the declared `maxInPeriod` per minute.

## Type System Guidelines

1. TypeScript-first: camelCase in the public API (not snake_case like the raw
   Roblox wire format)
2. Strict types: no `any`; prefer `unknown` for untyped data
3. Readonly responses: every response type is immutable
4. Export everything consumers need: all public types are re-exported

```typescript
// Response types are readonly
export interface GamePass {
	readonly id: string;
	readonly name: string;
	readonly isForSale: boolean;
}
```

## Security Considerations

1. API keys must never be logged or included in error messages
2. HTTPS only: no option to disable TLS
3. Zero dependencies: minimizes supply chain attack surface
4. Error sanitization: sensitive payload data is scrubbed before surfacing

## Runtime Compatibility

Supported runtimes:

- Node.js LTS (24.12+) (native `fetch`, `FormData`, `TextEncoder`)
- Bun 1.3+

Use standard web APIs exclusively so code runs on both:

- `fetch()` for HTTP
- `Uint8Array` for binary (not Node.js `Buffer`)
- `TextEncoder` / `TextDecoder` for encoding
- `FormData` for multipart

No Bun-specific APIs.

## Related Documentation

- Root [CLAUDE.md](../../CLAUDE.md): project context and workflow
- [ADR-003](../../docs/adr/003-testing-strategy.md): testing strategy (TDD, 100%
  coverage)
- [ADR-007](../../docs/adr/007-open-cloud-only.md): Open Cloud only (no legacy
  APIs)
- [ADR-008](../../docs/adr/008-zero-runtime-dependencies.md): zero runtime
  dependencies
- [ADR-009](../../docs/adr/009-result-types-over-exceptions.md): Result types
- [ADR-010](../../docs/adr/010-sdk-managed-rate-limiting-and-retry.md): rate
  limiting and retries
- [ADR-011](../../docs/adr/011-simplified-architecture-for-library-packages.md):
  simplified library architecture
- [ADR-012](../../docs/adr/012-class-based-clients-with-per-request-overrides.md):
  class-based clients with per-request overrides
- [docs/plans/2025-12-13-open-cloud-package-design.md](../../docs/plans/2025-12-13-open-cloud-package-design.md):
  historical design doc (superseded by the ADRs and the shipped code)
