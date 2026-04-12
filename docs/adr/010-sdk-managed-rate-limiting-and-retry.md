# ADR-010: SDK-Managed Rate Limiting and Retry in `@bedrock/open-cloud`

**Date:** 2026-04-12 **Status:** Accepted

Decision Makers: Maintainer Tags: open-cloud, rate-limiting, retry, resilience,
idempotency, observability

## Context

`@bedrock/open-cloud` is a standalone TypeScript HTTP client for Roblox Open
Cloud APIs, consumed primarily by the Bedrock CLI shell layer.

Deploying a game through the Bedrock CLI may issue dozens of concurrent
requests — creating game passes, creating developer products, uploading
thumbnails — all against API-key-scoped rate limits. Roblox publishes rate
limit constants per API, and a naive concurrent dispatch will hit 429s under
realistic deployment workloads.

Three questions need answering:

1. **Who manages concurrency and rate limits** — the SDK or the consumer?
2. **When should failed requests be retried**, and does the answer differ by
   operation type?
3. **How do consumers observe what the SDK is doing internally** (retries, rate
   limit waits) without being coupled to the control flow?

Constraints:

- **No idempotency key support**: Roblox Open Cloud does not document support
  for `Idempotency-Key` or equivalent headers
  ([reference](https://create.roblox.com/docs/cloud/reference/patterns)).
  Retrying a create after a 5xx can produce duplicate resources with no way to
  detect or clean them up.
- **Rate limit headers on 429 responses**: Roblox returns `x-ratelimit-limit`,
  `x-ratelimit-remaining`, and `x-ratelimit-reset` on throttled responses,
  giving the SDK a precise wait time.
- **Zero runtime dependencies (ADR-008)**: no `p-queue`, `bottleneck`, or
  similar — the queue must be implemented with standard JavaScript.
- **FCIS architecture (ADR-002)**: rate limiting and retry are I/O concerns;
  placing them in the CLI shell would pull I/O logic into orchestration code.
- **Rate limit constants are per-API**: known from Roblox documentation; the
  SDK is the natural home for that knowledge.

## Decision

**The SDK owns rate limiting, queuing, and retry behavior. Consumers fire
requests concurrently and receive `Result` values. They do not implement retry
loops, queues, or backoff logic.**

Specifically:

1. **Per-API-key queuing**. Each service client maintains a `RateLimitQueue`
   keyed by API key. Rate limit constants (requests per second, requests per
   minute) are hardcoded per API from Roblox documentation. Consumers do not
   configure them.

2. **Operation-differentiated retry policy**. Retry behavior is determined by
   operation type, not by a single global configuration:

   | Operation   | 429 (Rate Limit) | 5xx (Server Error) |
   | ----------- | ---------------- | ------------------ |
   | Create      | Retry            | **Do not retry**   |
   | Read / List | Retry            | Retry              |
   | Update      | Retry            | Retry              |
   | Delete      | Retry            | Retry              |

   Create operations skip 5xx retries because Roblox does not support
   idempotency keys. A retried create after a 500 could produce a duplicate
   resource with no way to detect it.

3. **Adaptive 429 backoff**. On a 429 response, the SDK reads
   `x-ratelimit-reset` from the response headers and waits that many seconds
   before retrying. If the header is missing or unparseable, the SDK falls back
   to exponential backoff: `min(1000 * 2^attempt, 30_000)` ms. Default: 3
   retries.

4. **Observability hooks**. `onRequest`, `onRetry`, and `onRateLimit` are
   notification-only, client-level callbacks. They are set once via
   `OpenCloudClientOptions` at construction and fire for every request the
   client makes. Consumers cannot cancel or alter retry behavior through
   them, and they are not available on `RequestOptions` — hooks are a
   client-level concern, not a per-request concern (see ADR-012).

   ```typescript
   const client = new GamePassesClient({
   	apiKey: "key",
   	onRateLimit: (waitMs) => logger.info(`rate limited, waiting ${waitMs}ms`),
   	onRequest: (request) => logger.debug(request),
   	onRetry: (attempt, error) => logger.warn({ attempt, error }),
   });
   ```

5. **Per-request overrides for advanced consumers**. Client-level
   `retryableStatuses` does **not** override the create-method safety guard.
   Only `RequestOptions.retryableStatuses` passed to a specific call can
   override it — for consumers who can guarantee idempotency externally (e.g.,
   by checking for the resource's existence before retrying).

## Consequences

### Positive

- **Consumers have no retry logic**: the CLI shell calls the SDK, handles the
  returned `Result`, and moves on. Queuing, pacing, and retries are invisible
  to orchestration code.
- **Correct idempotency semantics by default**: create operations cannot
  silently produce duplicate resources on 5xx. The asymmetry is enforced at
  the method level, not left to consumer discipline.
- **Precise 429 recovery**: using `x-ratelimit-reset` avoids over-waiting
  (exponential backoff overshoots) and under-waiting (immediate retry hits
  429 again).
- **Per-key isolation**: multiple API keys (e.g., a separate key for asset
  uploads) each maintain their own queue. Quotas are not conflated.
- **Observability without control flow coupling**: hooks let consumers log
  progress without implementing the retry state machine themselves.
- **Hooks are overridable per-request**: a consumer can enable verbose logging
  for a specific failing call without reconfiguring the client.

### Negative

- **No automatic recovery for failed creates on 5xx**: consumers must detect
  and handle failed create operations themselves. The SDK returns the error;
  the consumer decides whether to investigate, retry with idempotency
  guarantees, or surface the failure.
- **Multiple client instances sharing an API key are a correctness hazard,
  not just a performance gap**: two `GamePassesClient` instances with the
  same key maintain independent queues that do not coordinate, so the SDK's
  internal rate accounting is silently out of sync with Roblox's actual
  per-key quota. The 429 handling transparently recovers from the over-issue,
  but the SDK will have promised rate limiting it did not deliver. The
  correct-by-construction solution is per-request API key overrides on a
  single client instance (see ADR-012). Consumers who need to distribute
  work across multiple keys should use overrides, not additional client
  instances. Bedrock CLI uses one client per resource type in any case.
- **Hooks are fire-and-forget**: `onRequest`, `onRetry`, and `onRateLimit`
  cannot cancel, delay, or modify retry behavior. Consumers who need that
  level of control must wrap the SDK, not reach inside it.
- **Rate limit constants are static**: each client hardcodes limits from
  Roblox documentation. If Roblox changes undocumented limits, 429s will
  still occur — the adaptive `x-ratelimit-reset` handling absorbs this, but
  the SDK will not learn the new limit without a code change.

### Neutral

- The `retryableStatuses` option remains on `OpenCloudClientOptions`, but its
  effect on create methods is intentionally scoped: only `RequestOptions`
  overrides it for creates. This asymmetry is documented but is not a
  general-purpose pattern elsewhere in the SDK.
- Queue size is unbounded. High-volume consumers should be aware of memory
  implications when enqueueing thousands of requests against a single client.

## Alternatives Considered

### Consumer-Managed Rate Limiting (CLI Owns the Queue)

The CLI implements its own rate limit queue and paces requests before calling
the SDK. The SDK stays a thin HTTP wrapper.

**Pros**: SDK is simpler; rate limiting is visible at the application level;
consumers have maximum control.

**Rejected because:**

- Every consumer must re-implement the same queuing and backoff logic — error
  prone and duplicated across integrations.
- FCIS (ADR-002) places I/O concerns in the I/O layer; rate limiting is I/O,
  not business logic.
- Roblox rate limit constants are API-specific knowledge; the SDK is the
  natural home for them, not every caller.
- Couples the CLI's orchestration logic to Roblox's rate limit details, which
  leaks implementation detail across the boundary.

### Uniform Retry Policy (All Operations Retry on 429 and 5xx)

A single configurable `retryableStatuses` list applies to every operation,
including creates.

**Pros**: simpler internal implementation; one retry path; no per-method
branching.

**Rejected because:**

- Roblox does not support idempotency keys. Retrying a create on 5xx can
  produce duplicate game passes, developer products, or thumbnails with no
  way to detect or clean up the duplicates.
- The asymmetry between create and read/update/delete is a correctness
  requirement, not a stylistic preference. Uniformity would trade correctness
  for simplicity.

### Blind Exponential Backoff Only (Ignore `x-ratelimit-reset`)

The SDK retries 429s using exponential backoff regardless of the response
headers.

**Pros**: no coupling to Roblox-specific header format; the SDK is a generic
HTTP client.

**Rejected because:**

- Exponential backoff either over-waits (wasting time on short windows) or
  under-waits (hitting 429 again immediately). `x-ratelimit-reset` gives a
  precise answer — ignoring it is strictly worse.
- The SDK is already Roblox-specific (ADR-007, Open Cloud only). "Avoiding
  coupling" to Roblox response headers is not a meaningful constraint for
  a Roblox-dedicated client.
- Falling back to exponential backoff when the header is missing preserves
  robustness without sacrificing precision when the header is present.

### No Built-in Retry (Return Errors Directly)

The SDK returns `RateLimitError` and `ApiError` directly; consumers implement
their own retry loops.

**Pros**: maximum consumer control; SDK has no retry state; simplest internal
implementation.

**Rejected because:**

- Consumers must implement exponential backoff, jitter, 429 recovery, and the
  create/5xx idempotency rule for every integration. High risk of incorrect
  implementations.
- Retry loops in the CLI mix I/O concerns into shell orchestration, violating
  FCIS (ADR-002).
- The idempotency constraint must still be communicated and respected by
  every caller — SDK-level enforcement is the only reliable way to prevent
  duplicate resources.

## Implementation Notes

- `packages/open-cloud/src/internal/http/rate-limit-queue.ts` — `RateLimitQueue`
  class; per-API-key instances created lazily inside each service client.
- Rate limit constants (`requestsPerSecond`, `requestsPerMinute`) are defined
  per client from Roblox documentation. Values must be researched and
  confirmed during implementation — the design plan uses placeholder values.
- `executeWithRetry` is a private method on each service client.
  `shouldRetry` checks both the error type and the operation-specific
  `retryableStatuses`.
- Create methods hardcode `retryableStatuses: [429]` at the method level.
  Read, list, update, and delete methods default to
  `[429, 500, 502, 503, 504]`.
- On a 429 response, `RateLimitError.retryAfterSeconds` is populated from
  `x-ratelimit-reset` when present; the retry delay logic prefers this value
  over the exponential backoff schedule.
- Client-level `retryableStatuses` in `OpenCloudClientOptions` does not
  override the create-method guard. Only `RequestOptions.retryableStatuses`
  passed to a specific `create()` call can. This is enforced by merging
  `RequestOptions` over the method-level default, not over the client-level
  default.
- If Roblox adds idempotency key support in the future, `RequestOptions` can
  accept an `idempotencyKey` field, and create methods can enable 5xx retries
  when it is present. The per-request override mechanism above is the forward-
  compatible path.

## Related Decisions

- **ADR-002**: FCIS Architecture — SDK is the I/O layer; rate limiting and
  retry are I/O concerns and belong here, not in CLI orchestration.
- **ADR-003**: Testing strategy — retry and queue behavior must reach 100%
  branch coverage; the fake HTTP client
  (`tests/helpers/fake-http-client.ts`) enables this without real rate limits
  or sleeps.
- **ADR-007**: Open Cloud only — all traffic goes to Roblox Open Cloud; rate
  limit constants and header formats are sourced from Roblox documentation.
- **ADR-008**: Zero runtime dependencies — the queue is implemented from
  scratch using standard JavaScript; no `p-queue` or equivalent.
- **ADR-009**: Result types over exceptions — retry logic returns `Result` on
  exhaustion; `RateLimitError` carries `retryAfterSeconds` for consumer
  display when desired.

## References

- [Roblox Open Cloud API Reference](https://create.roblox.com/docs/cloud/reference)
- [Roblox Open Cloud Common Patterns](https://create.roblox.com/docs/cloud/reference/patterns)
- [Roblox Cloud Rate Limits](https://github.com/Roblox/creator-docs/blob/main/content/en-us/cloud/reference/rate-limits.md)
- [Open Cloud Package Design Plan](../plans/2025-12-13-open-cloud-package-design.md)
