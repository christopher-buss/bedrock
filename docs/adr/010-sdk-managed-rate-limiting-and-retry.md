# ADR-010: SDK-Managed Rate Limiting and Retry in `@bedrock-rbx/ocale`

**Date:** 2026-04-12 **Status:** Accepted

Decision Makers: Maintainer Tags: open-cloud, rate-limiting, retry, resilience,
idempotency, observability

## Context

`@bedrock-rbx/ocale` is a standalone TypeScript HTTP client for Roblox Open
Cloud APIs, consumed primarily by the Bedrock CLI shell layer.

Deploying a game through the Bedrock CLI may issue dozens of concurrent requests
— creating game passes, creating developer products, uploading thumbnails — all
against API-key-scoped rate limits. Roblox publishes rate limit constants per
API, and a naive concurrent dispatch will hit 429s under realistic deployment
workloads.

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
- **Rate limit constants are per-API**: known from Roblox documentation; the SDK
  is the natural home for that knowledge.

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
   client makes. Consumers cannot cancel or alter retry behavior through them,
   and they are not available on `RequestOptions` — hooks are a client-level
   concern, not a per-request concern (see ADR-012).

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
  returned `Result`, and moves on. Queuing, pacing, and retries are invisible to
  orchestration code.
- **Correct idempotency semantics by default**: create operations cannot
  silently produce duplicate resources on 5xx. The asymmetry is enforced at the
  method level, not left to consumer discipline.
- **Precise 429 recovery**: using `x-ratelimit-reset` avoids over-waiting
  (exponential backoff overshoots) and under-waiting (immediate retry hits 429
  again).
- **Per-key isolation**: multiple API keys (e.g., a separate key for asset
  uploads) each maintain their own queue. Quotas are not conflated.
- **Observability without control flow coupling**: hooks let consumers log
  progress without implementing the retry state machine themselves.
- **Hooks are overridable per-request**: a consumer can enable verbose logging
  for a specific failing call without reconfiguring the client.

### Negative

- **No automatic recovery for failed creates on 5xx**: consumers must detect and
  handle failed create operations themselves. The SDK returns the error; the
  consumer decides whether to investigate, retry with idempotency guarantees, or
  surface the failure.
- **Multiple client instances sharing an API key are a correctness hazard, not
  just a performance gap**: two `GamePassesClient` instances with the same key
  maintain independent queues that do not coordinate, so the SDK's internal rate
  accounting is silently out of sync with Roblox's actual per-key quota. The 429
  handling transparently recovers from the over-issue, but the SDK will have
  promised rate limiting it did not deliver. The correct-by-construction
  solution is per-request API key overrides on a single client instance (see
  ADR-012). Consumers who need to distribute work across multiple keys should
  use overrides, not additional client instances. Bedrock CLI uses one client
  per resource type in any case.
- **Hooks are fire-and-forget**: `onRequest`, `onRetry`, and `onRateLimit`
  cannot cancel, delay, or modify retry behavior. Consumers who need that level
  of control must wrap the SDK, not reach inside it.
- **Rate limit constants are static**: each client hardcodes limits from Roblox
  documentation. If Roblox changes undocumented limits, 429s will still occur —
  the adaptive `x-ratelimit-reset` handling absorbs this, but the SDK will not
  learn the new limit without a code change.

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
- FCIS (ADR-002) places I/O concerns in the I/O layer; rate limiting is I/O, not
  business logic.
- Roblox rate limit constants are API-specific knowledge; the SDK is the natural
  home for them, not every caller.
- Couples the CLI's orchestration logic to Roblox's rate limit details, which
  leaks implementation detail across the boundary.

### Uniform Retry Policy (All Operations Retry on 429 and 5xx)

A single configurable `retryableStatuses` list applies to every operation,
including creates.

**Pros**: simpler internal implementation; one retry path; no per-method
branching.

**Rejected because:**

- Roblox does not support idempotency keys. Retrying a create on 5xx can produce
  duplicate game passes, developer products, or thumbnails with no way to detect
  or clean up the duplicates.
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
  coupling" to Roblox response headers is not a meaningful constraint for a
  Roblox-dedicated client.
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
- The idempotency constraint must still be communicated and respected by every
  caller — SDK-level enforcement is the only reliable way to prevent duplicate
  resources.

## Implementation Notes

- `packages/open-cloud/src/internal/http/rate-limit-queue.ts` — `RateLimitQueue`
  class; per-API-key instances created lazily inside each service client.
- Rate limit constants (`requestsPerSecond`, `requestsPerMinute`) are defined
  per client from Roblox documentation. Values must be researched and confirmed
  during implementation — the design plan uses placeholder values.
- `executeWithRetry` is a private method on each service client. `shouldRetry`
  checks both the error type and the operation-specific `retryableStatuses`.
- Create methods hardcode `retryableStatuses: [429]` at the method level. Read,
  list, update, and delete methods default to `[429, 500, 502, 503, 504]`.
- On a 429 response, `RateLimitError.retryAfterSeconds` is populated from
  `x-ratelimit-reset` when present; the retry delay logic prefers this value
  over the exponential backoff schedule.
- Client-level `retryableStatuses` in `OpenCloudClientOptions` does not override
  the create-method guard. Only `RequestOptions.retryableStatuses` passed to a
  specific `create()` call can. This is enforced by merging `RequestOptions`
  over the method-level default, not over the client-level default.
- If Roblox adds idempotency key support in the future, `RequestOptions` can
  accept an `idempotencyKey` field, and create methods can enable 5xx retries
  when it is present. The per-request override mechanism above is the forward-
  compatible path.

## Related Decisions

- **ADR-002**: FCIS Architecture — SDK is the I/O layer; rate limiting and retry
  are I/O concerns and belong here, not in CLI orchestration.
- **ADR-003**: Testing strategy — retry and queue behavior must reach 100%
  branch coverage; the fake HTTP client (`tests/helpers/fake-http-client.ts`)
  enables this without real rate limits or sleeps.
- **ADR-007**: Open Cloud only — all traffic goes to Roblox Open Cloud; rate
  limit constants and header formats are sourced from Roblox documentation.
- **ADR-008**: Zero runtime dependencies — the queue is implemented from scratch
  using standard JavaScript; no `p-queue` or equivalent.
- **ADR-009**: Result types over exceptions — retry logic returns `Result` on
  exhaustion; `RateLimitError` carries `retryAfterSeconds` for consumer display
  when desired.

## References

- [Roblox Open Cloud API Reference](https://create.roblox.com/docs/cloud/reference)
- [Roblox Open Cloud Common Patterns](https://create.roblox.com/docs/cloud/reference/patterns)
- [Roblox Cloud Rate Limits](https://github.com/Roblox/creator-docs/blob/main/content/en-us/cloud/reference/rate-limits.md)
- [Open Cloud Package Design Plan](../plans/2025-12-13-open-cloud-package-design.md)

## Amendment: 2026-05-24, retry transient transport errors

The original Decision only retries `RateLimitError` (429) and `ApiError` (5xx,
by operation kind). `NetworkError` — the transport class wrapping `ECONNRESET`,
`ETIMEDOUT`, DNS failures, and similar — was never retried, because it carries
no HTTP status for `shouldRetry` to match against. A transport failure therefore
terminated the request on the first occurrence.

This bit a long-running `--workspace` Luau-execution run in project-halcyon
(christopher-buss/project-halcyon#482), which aborted on `read ECONNRESET`
mid-poll. A connection reset is normal: Roblox closes idle keep-alive sockets,
and the Node/undici/Bun keep-alive socket-reuse race is documented and won't-fix
in the runtimes — the established guidance is for the client to retry idempotent
requests. The retry pipeline existed but excluded the one error class that most
warranted retrying for an idempotent GET.

The retry policy gains a transport axis parallel to `retryableStatuses`:

- **`retryableTransportCodes`** — a node-style error-code allowlist applied to
  `NetworkError`. `shouldRetry` walks the error's `cause` chain, reads the
  underlying `code`, and retries when it is a member. The code is detected
  through the chain because `fetch` surfaces resets as
  `NetworkError → TypeError("fetch failed") → OS Error{code}`.
- **Idempotent operations** (read, list, update, delete) default to the
  transient set
  `ECONNRESET, ECONNREFUSED, ETIMEDOUT, EPIPE, ENETUNREACH, EHOSTDOWN, EAI_AGAIN, UND_ERR_SOCKET`.
- **Create operations** default to none, for the same duplicate-resource reason
  the 5xx guard exists. A read-side reset can arrive after the server already
  processed the create, and Roblox has no idempotency keys. Consumers who can
  tolerate a duplicate (a re-published place version, a re-run Luau task) opt in
  through the per-request override only — the same merge precedence that scopes
  `retryableStatuses` keeps a client-level setting from silently relaxing create
  safety.
- **Self-aborts are never retried.** Ocale's own request-timeout `AbortSignal`
  produces an error with no node-style `code`, so the allowlist excludes it by
  construction. A genuine 30s timeout is a real signal, not a transient blip.

Transport retries reuse the existing `maxRetries` budget and the
`defaultRetryDelay` exponential schedule (`1s → 2s → 4s …`); there is no
`Retry-After` for a transport failure.

Two supporting changes land with the policy:

- **`NetworkError` carries `method` and `url`.** A transport failure that
  survives all retries now names the call that failed. The URL is safe to
  surface — the API key travels in the `x-api-key` header, never the URL.
- **The Luau-execution poll loop is bounded against transient failures.**
  Previously a single failed poll aborted the whole loop. It now tolerates a
  transient-transport poll failure and continues within the existing wall-clock
  `timeoutMs`, but bails early after `maxConsecutivePollFailures` (default 3) so
  a genuinely-unreachable endpoint stops in seconds rather than spinning out the
  full budget. Only a `NetworkError` carrying a known transient transport code
  is re-polled; a self-aborted request timeout (no code) aborts immediately,
  matching the per-request policy. A non-transport failure (a 404 meaning the
  task is gone, a 403) likewise aborts immediately — there is nothing to poll. A
  successful poll resets the counter.

New public surface: `retryableTransportCodes` on `OpenCloudClientOptions` and
`RequestOptions`; `method` and `url` on `NetworkError`;
`maxConsecutivePollFailures` on the poll options. The create idempotency
guarantee is unchanged — duplicate-resource risk stays gated behind an explicit
per-request opt-in.

## Amendment: 2026-06-17, per-request timeout follows the poll budget for polled operations

The original Decision treats the 30s per-request `timeout` as a universal
default and the prior amendment reinforces it: "a genuine 30s timeout is a real
signal, not a transient blip," and a self-abort — carrying no node-style `code`
— is never retried. That holds for snappy CRUD, where 30s of silence is a
genuine fault.

It does not hold for `LuauExecutionClient.tasks.runUntilDone` / `pollUntilDone`.
The submit endpoint only enqueues a task (it "does not wait for the task to
complete"), and a poll `get` is a plain state read, so both should answer in
well under a second. But Roblox's task-create and cold-`get` latencies routinely
spike past 30s under load. When they do, the request self-aborts at the 30s
default — an error the retry layer excludes by construction and the poll loop
classifies as a hard failure — so the operation dies before its own wall-clock
budget (`timeoutMs`) is ever consulted. This produced frequent, non-recoverable
timeout failures in the jest-roblox-cli runner, whose poll budget is 5 minutes.

The fix derives the per-request deadline from the budget the caller already
declared rather than a fixed constant:

- **`runUntilDone` and `pollUntilDone` default each submit and poll request's
  `timeout` to `timeoutMs`** (falling back to the 300s default budget) when the
  caller has not set one. The value is not a magic number — it is the patience
  the caller already chose for the whole operation. A single request stays alive
  long enough for the backend to answer or to surface a _retryable_ status (a
  5xx, or a TCP-level `ECONNRESET`) instead of a self-abort the retry layer
  never retries.
- **An explicit per-request `timeout` still wins**, via the same merge
  precedence that scopes the retry fields. This is why the default is applied in
  the options layer and not as a method default: for the idempotent poll `get`,
  client config beats method defaults, but per-request options beat both.

This is the same recognition behind dropping the default timeout for upload
methods (christopher-buss/bedrock#463): the one-size 30s CRUD default does not
fit every request class. The two carve-outs differ in shape — uploads omit the
deadline entirely because their duration is bandwidth-bound and unknowable,
whereas polled luau-execution requests keep a _finite_ budget-derived deadline
so a true black-hole still bails and a TCP reset stays retryable.

No new public surface: the behavior lives in an internal helper applied at the
two polling entry points and is not exported from the package barrel.

A latent gap remains and is tracked separately (christopher-buss/bedrock#466):
the poll budget is only checked between iterations and is not wired to an
in-flight `AbortSignal`, so a single request is still not bounded by the
_remaining_ budget, and budget exhaustion mid-flight surfaces as a transport
`NetworkError` rather than the documented `PollTimeoutError`.

## Amendment: 2026-06-22, adaptive throttling from the live remaining budget

The original Decision paces requests with a **static** per-operation token
bucket (`requestsPerSecond` from the vendored OpenAPI) and recovers from a 429
reactively via `x-ratelimit-reset`. Two facts, established by a live probe
against the real API (one API key + IP), show that static pacing is structurally
unreliable and that better information was being discarded:

- **The static constants drift from reality.** The schema encodes 200/min for
  `Cloud_GetLuauExecutionSessionTask`; the probe measured a real ceiling of
  exactly 100/min on `Cloud_GetUniverse`, and the human docs disagree with both.
  A hardcoded ceiling cannot track an undocumented limit.
- **Roblox returns the live budget on every response.** `x-ratelimit-remaining`
  (and `-limit`, `-reset`) appear on 200/403/429 across four API families —
  absent only on a 404 (the gateway short-circuits before the rate-limit layer).
  So the headers are best-effort, not guaranteed.

Two parsing facts also surfaced: on a 429, `x-ratelimit-reset` is a
comma-separated **list** of per-window resets (e.g. `"22, 0"`), and
`retry-after` (5s) **understates** the true reset (22s). The list parse is
reduced with `max` for reset (longest wait) and `min` for remaining (most
constrained); the `retry-after`-understates-`reset` finding is why the SDK keeps
preferring `x-ratelimit-reset` over the header the docs nominally recommend.

The amendment adds a **header-primed budget gate** alongside the existing
machinery (which is unchanged and remains the fallback):

- **Observe every response.** Each attempt parses a
  `{ remaining, resetSeconds }` sample and folds it back into the gate. A 2xx
  carries the budget in its headers; a 429 carries it on
  `RateLimitError.remaining` — previously the 429 path built no header record,
  so the one response that proves exhaustion dropped its budget signal. That
  error now carries `remaining`.
- **Gate per attempt, not per acquire.** The token bucket grants one token for a
  whole logical call, so gating only at acquisition cannot stop the retry-loop
  attempts that share the token. The gate lives in the `send` closure and runs
  before every attempt.
- **Two pacing regimes.** While budget remains, requests are spaced evenly over
  the time left in the window (`timeLeft / remaining`), so a burst does not
  spend the window up front and then stall; the first send in a window goes
  immediately. Once the budget is spent, requests hold until reset. Pacing runs
  at the **server-observed** rate, so it self-corrects when the static ceiling
  is wrong.
- **Per-key scope, not per-operation.** The gate keys one budget per API key. A
  per-operation tracker was prototyped and dropped: every operation reports the
  same most-constrained `remaining`, and a per-key tracker drawn down by all
  operations is always the binding constraint, so a per-operation tracker could
  never independently fire. Per-key is also where the value is — a deploy's 429s
  come from many operations sharing the per-key window, which a per-operation
  bucket cannot see.
- **Last-writer-wins observation.** Observe time is monotonic (stamped when the
  response resolves), so the most recent sample is the best estimate; no
  timestamp-staleness bookkeeping is kept.

Static-bucket pacing is retained for cold start (no sample yet) and for
endpoints that omit the headers (404s and any future gap), since a missing or
non-numeric header parses to `undefined` and leaves that scope on static pacing.

Known limitations (residual, accepted): the per-key `remaining` is the _minimum_
across all of Roblox's overlapping windows, so when only a route-specific window
is exhausted the gate over-throttles other operations on that key until the next
observation refreshes it; a concurrent burst before the first observation can
still overshoot (bounded — the next observation corrects it, and the reactive
429 retry path remains as defense in depth); and the multi-client/multi-process
per-key hazard from the original Decision is unchanged. Auto-correcting the
static `requestsPerSecond` from `x-ratelimit-limit` is intentionally **not**
attempted — `remaining`/`reset` already demote the static value to a pure
fallback.

No new public surface: the gate is internal, parsing reductions are internal,
and `RateLimitError` only gains a `remaining` field (additive). A consumer hook
to observe proactive holds (`onRateLimitHeaders`) was considered and deferred to
avoid overloading the existing `onRateLimit` callback, which already signals
both static-bucket and retry waits.

## Amendment: 2026-07-29, place uploads opt out of connection reuse and retry gateway rejections

The 2026-05-24 amendment gave idempotent operations a transport retry axis and
deliberately left create operations with an empty `retryableTransportCodes`, for
the duplicate-resource reason behind the 5xx guard. Place publish and save are
create operations, so they retried nothing but 429 — and they are the calls most
exposed to the keep-alive socket-reuse race that amendment described, because an
upload occupies a connection far longer than a JSON GET.

A consumer repo's CI deploys failed on roughly two thirds of runs, each time
with one of three places failing and the other two succeeding. The failure
surfaced as `ApiError` with a `gatewaySummary` (an HAProxy `400 Bad request`
page, ~75s in) or as `NetworkError`/`ECONNRESET`.

A probe publishing to three places on the queue's own 2s cadence isolated the
cause:

- Pooling clients reproduce it. Node/undici and Bun both stall a request and
  lose it (locally at exactly 19.0s, Windows TCP giving up on retransmission).
- `curl`, one process per request, does not — no pooled connection to reuse.
- The same client with `connection: close` does not: 6/6 succeed sub-second
  where pooling lost one every time.

It is not concurrency (a strictly sequential run reproduces it), not content
processing (it reproduces on a payload the server rejects in 0.9s), and not
payload size.

The decision gains two parts:

1. **Uploads set `connection: close`.** Applied by the transport to every
   request `isUploadRequest` classifies — the same predicate that already drops
   the default timeout, for the same reason: uploads are bandwidth-bound and
   hold a connection far longer than a JSON call. Place publishes are the
   observed victim, but icon, thumbnail, and binary-input uploads share the
   exposure, so the directive belongs to the shape rather than to one endpoint.
   The cost is a fresh handshake and a cold congestion window per upload, paid
   again on each retry. The many small resource calls in a deploy keep their
   pooled connections.
2. **`UPLOAD_METHOD_DEFAULTS`.** Publish and save stay off the 5xx retry path,
   which is where the duplicate-write risk actually lives, but retry failures
   that never reached Open Cloud: the transient transport set, plus a synthetic
   `GATEWAY_REJECTED` code. `shouldRetry` classifies an `ApiError` carrying a
   `gatewaySummary` by that code instead of its status, because the status came
   from the gateway and says nothing about the request's validity.

The duplicate-write objection is weaker than assumed for place versions.
Version-number forensics confirmed a killed publish creates nothing, and Roblox
dedupes identical place content — re-uploading unchanged bytes returns the
existing version number rather than minting a new one, so a retry that races a
publish which did land returns that same version.

Not extended to other creates: game-pass and developer-product creates have no
comparable dedupe, so their empty transport allowlist stands. Extending
gateway-rejection retry to idempotent methods is a natural follow-up and is
deliberately out of scope here.

## Amendment: 2026-07-31, uploads pin HTTP/1.1 because the connection directive is inert under h2

The 2026-07-29 amendment fixed the keep-alive race by having uploads send
`connection: close`. That was verified on Node 24 and Bun, and it holds there.
It does nothing on Node 26.

Node 26 bundles undici 8, which enables HTTP/2 by default (undici
[#4828](https://github.com/nodejs/undici/pull/4828), taken into Node in
[nodejs/node#62384](https://github.com/nodejs/node/pull/62384)). `Connection` is
a connection-specific header, forbidden in HTTP/2, so an h2 transport drops it
before the wire. Worse, h2 multiplexes: every upload to `apis.roblox.com` shares
one session, where HTTP/1.1 plus `connection: close` gave each its own.

A consumer deploy failed with all three places lost, two of them at the same
millisecond — one session died and took both in-flight streams with it. The
codes were `ERR_HTTP2_STREAM_ERROR` and `UND_ERR_INFO`, neither of which was in
`TRANSIENT_TRANSPORT_CODES`, so nothing retried.

Measured against a local server offering ALPN `["h2", "http/1.1"]`:

| Client              | ALPN     | TCP connections for 2 uploads | `connection` on the wire |
| ------------------- | -------- | ----------------------------- | ------------------------ |
| Node 26.5.1 `fetch` | h2       | 1                             | absent (stripped)        |
| Node 24.18 `fetch`  | http/1.1 | 2                             | `close`                  |
| Bun 1.3.14 `fetch`  | http/1.1 | 2                             | `close`                  |

Bun implements `node:http2`, but its `fetch` does not offer h2 in ALPN, so Bun
is unaffected. The exposure is Node 26 and later.

The decision gains two parts:

1. **Uploads pin HTTP/1.1.** There is no standard `fetch` option for this, and
   the documented route — `setGlobalDispatcher(new Agent({ allowH2: false }))` —
   means depending on undici, which ADR-008 rules out. Instead the transport
   reconstructs the class of the runtime's own global dispatcher, reached via
   undici's versioned global symbol, with `allowH2: false`. This costs no
   dependency and re-arms the directive the previous amendment relies on.

   The symbol is an internal contract that moved from `.1` to `.2` in undici 8
   and can move again. Every step is therefore guarded — absent symbol,
   non-constructible value, throwing constructor — and each falls back to the
   runtime's default transport rather than failing the deploy. A future contract
   move degrades to the pre-amendment behaviour, which part 2 covers. Resolution
   is lazy, because undici publishes the global dispatcher only after the
   process's first `fetch`; the first request of a process has no pooled
   connection to lose, so nothing is exposed by the delay.

2. **The h2 codes join `TRANSIENT_TRANSPORT_CODES`.** `ERR_HTTP2_STREAM_ERROR`,
   `ERR_HTTP2_SESSION_ERROR`, and `UND_ERR_INFO` are the h2 spellings of the
   socket deaths already in that set.

Part 2 weakens a claim the previous amendment made. The transient set was
described as failures that never reached Open Cloud. That is not true of the h2
codes: `UND_ERR_INFO` covers both a `GOAWAY` declaring a stream was never
started and a stream that was fully sent. It is not strictly true of
`UND_ERR_SOCKET` either, which can fire once a response is already streaming.
For idempotent methods this changes nothing. For uploads, retry safety rests
where the previous amendment actually put it: Roblox dedupes identical place
content, so a retry that races a publish which did land returns that same
version. The doc comments now say so. An upload-classified operation without
content dedupe would need its own allowlist.

Deliberately out of scope: a wall-clock budget for uploads. A gateway
`RST_STREAM(CANCEL)` produces no error event and undici dequeues the request
without rejecting it, so a `fetch` never settles; uploads carry no timeout by
design (ADR-010's upload exemption), which makes that hang unbounded. Retries
cannot reach it, since nothing ever fails. It needs its own decision, and an
upstream fix.

## Amendment: 2026-08-17, an unparseable 2xx body is a retryable transport failure

Every retry decision so far keyed an `ApiError` on its HTTP status, with the
2026-07-29 amendment's `GATEWAY_REJECTED` as the one exception. That leaves a
gap the status axis cannot express: the transport also builds an `ApiError` when
a **2xx** body fails to parse as JSON, and its status is 200, which no
`retryableStatuses` list contains. Such an error was therefore unretryable by
construction.

It was observed in a consumer repo's CI: a run over four packages failed with
`SyntaxError: Unterminated string in JSON at position 1572740` under
`Failed to parse response body`, and an immediate re-run passed. V8 reports that
position as the length of the text it received, so the body stopped mid-string
at exactly the bytes delivered. The response was HTTP 200 and the stream ended
cleanly — an aborted body surfaces as a `NetworkError` from undici, not as a
parse failure — so the edge served a short body. The failing call was the poll
`GET` of a luau-execution task, whose result envelope is the largest body such a
run reads.

The decision gains two parts:

1. **The parse failure carries its request.** The transport threads its request
   context (method, url, elapsed time, allowlisted response headers) onto that
   `ApiError`, as it already did for error responses, and records the received
   body length on `ApiError.unparsedBodyLength` and in the message. The length
   is the diagnostic number: `details` retains only the first 500 characters, so
   for a body that stopped mid-token the head says nothing, while a
   `SyntaxError` position equal to the length identifies a truncated read rather
   than a malformed document.

2. **`RESPONSE_UNPARSEABLE`.** A synthetic transport code, classified like
   `GATEWAY_REJECTED`: `shouldRetry` checks an `ApiError` carrying an
   `unparsedBodyLength` against `retryableTransportCodes` and never consults its
   status. It joins `IDEMPOTENT_METHOD_DEFAULTS` only.

Unlike `GATEWAY_REJECTED`, this code says nothing about whether the request was
processed — a 200 proves it was. Retry safety therefore rests entirely on the
operation being safe to repeat, which is why creates and uploads leave it out:
their write landed, and re-issuing it merely to re-read the answer would risk a
second resource for the sake of a response body. `UPLOAD_METHOD_DEFAULTS` gets
no exception here, even though place content dedupes, because the failure it
would recover from is a read problem and the retry would repeat a write.

The alternative was widening the luau-execution poll loop's own tolerance so a
parse failure counted against `maxConsecutivePollFailures`. Rejected as too
narrow: the loop is one caller of a transport-level defect, and a truncated body
can land on any idempotent read. Loop tolerance stays what it documents —
`NetworkError` with a transient code — and by the time a parse failure reaches
it, the request-level retry budget is already spent.

## Amendment: 2026-08-28, the header-primed gate tracks a window per operation

The 2026-06-22 amendment scoped the budget gate per API key, on the premise that
"every operation reports the same most-constrained `remaining`, and a per-key
tracker drawn down by all operations is always the binding constraint, so a
per-operation tracker could never independently fire". Measurement since has
shown that premise to be wrong.

A live probe against the Luau Execution submit endpoints
(`docs/spikes/luau-submit-rate-limits/README.md`, run for issue #541) read two
operations on **one API key at one instant** reporting different budgets: the
head submit at 38 of 40 remaining, the version-pinned submit at 1 of 5. Three
pinned submits moved head's `remaining` by exactly one, the reader's own head
call. Roblox meters each operation in its own per-key bucket, and the ceilings
are additive rather than a shared minimum. The values match
`x-roblox-rate-limits` in the vendored schema, which already encodes 40 for the
head operation and 5 for the pinned one.

Because `BudgetTracker.observe` is last-writer-wins, one tracker fed by several
operations thrashes between unrelated windows. Both directions are reachable in
a single `runUntilDone`, where submit (40/min), get (200/min) and listLogs
(45/min) responses all land on one tracker:

- **Under-pacing.** A get reporting `remaining=199` erases a submit's
  near-exhausted window, so the next submit goes out unpaced into a bucket with
  nothing left. This is the failure the header-primed gate exists to prevent.
- **Over-pacing.** A submit reporting `remaining=0` holds the polling gets until
  the submit window resets, against a bucket with hundreds of calls to spare.

The gate now keys its tracker map and its serializing promise chain on a
`BudgetScope` of API key and operation key, the pairing `ResourceClient` already
uses for its `RateLimitQueue` registry. Each operation holds its own window, and
a reading from one no longer moves another. Concurrent requests on different
operations of one key no longer serialize behind each other either, which is
correct: they draw down independent windows.

The rest of the 2026-06-22 amendment stands. Observation is still
last-writer-wins, now within one operation's window, where monotonic observe
time makes the latest sample the best estimate. The static per-operation token
bucket remains the cold-start and header-absent fallback, and the reactive 429
retry path remains as defense in depth.

Two limitations recorded in 2026-06-22 change shape. The over-throttling one is
resolved: a route-specific window reaching zero no longer holds unrelated
operations. What replaces it is narrower and accepted: a per-operation window is
blind to the account-wide quota Roblox also enforces (the trailing `70000` token
in `x-ratelimit-limit`), so a deploy fanning out across many operations can
still reach a ceiling no single tracker is watching. The reactive 429 path
covers it, and modelling the global window is deferred until a deploy is
observed hitting it. The multi-client and multi-process per-key hazard from the
original Decision is unchanged.

`BudgetScope` is internal, so there is no public surface change.
