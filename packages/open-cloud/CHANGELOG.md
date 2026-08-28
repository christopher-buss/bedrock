# @bedrock-rbx/ocale

## 0.2.0

### Minor Changes

- Parse a developer product the create endpoint answered with. `POST /developer-products/v2/universes/{universeId}/developer-products` returns a body without `storePageEnabled`, which the read endpoint reports it on and the vendored schema marks required, so every create was rejected as a malformed response and the product it had just made was unreachable. The field is now read as absent rather than invalid, and `DeveloperProduct.storePageEnabled` is `boolean | undefined` to say so. A present value that is not a boolean is still malformed.

  Callers assigning `storePageEnabled` straight to a `boolean` need to handle the absent case; reading it as a condition is unchanged.

- Refresh the vendored Open Cloud OpenAPI spec and surface the new required isManagedPricingEnabled field on GamePass and DeveloperProduct responses. Response parsers now require the field, and constructing these response types (for example in test fakes) needs the new property, so this is a breaking boundary for 0.x consumers. Also repairs the spec refresh flow: schema patches expand $n capture groups again instead of inserting them literally, the sorted-map items rename patch (fixed upstream by Roblox) is removed, and an unchanged pinned commit no longer aborts the refresh.

### Patch Changes

- Pace each operation against its own live rate-limit window. The header-primed budget gate read `x-ratelimit-remaining`/`-reset` off every response into a single window per API key, but Roblox meters each operation in its own per-key bucket, and those buckets have different ceilings: on one key at one instant, the Luau Execution head submit reports 38 of 40 left while the version-pinned submit reports 1 of 5. Folding both into one window made the gate thrash between unrelated buckets. A roomy reading from a `get` erased a near-exhausted `submit` window, so submits went out unpaced into a bucket with nothing left; an exhausted `submit` reading held polling `get`s until the submit window reset, minutes of waiting against a bucket with hundreds of calls to spare. Each operation now holds its own window per key, so a reading from one no longer moves another. The static per-operation token bucket, the cold-start and header-absent fallback, is unchanged.

- pace version-pinned luau submits from their own 5/min quota

- Keep the request context when a 401 or 403 is upgraded to a `PermissionError`. The upgrade rebuilt the transport's `ApiError` and carried only `cause`, `code`, `details`, and `statusCode`, so `elapsedMs`, `gatewaySummary`, `method`, `responseHeaders`, and `url` came back undefined on exactly the two statuses where naming the failing call and the credential is the whole question. Every other status already reported them.

  A 401 or 403 served by an edge gateway is no longer upgraded at all. It arrives with a `gatewaySummary` and never reached the operation whose scopes the upgrade would name, so reporting it as a scope failure sent the caller to their API key settings over a request Open Cloud never saw. It stays an `ApiError`, as the other statuses a gateway answers with already did.

  New `requestContextOf(err)` reads those transport-captured fields off an `ApiError` for spreading into the options of a replacement error, so a consumer that rewraps a failure with its own message keeps the context instead of enumerating the fields by hand.

- Parse a universe whose social link comes back as JSON `null`. The wire validator accepted `null` for every optional social link, and the mapper then read `.title` off it and threw `TypeError: Cannot read properties of null`, so one null link failed the whole `universes.get` or `universes.update` response. A null link now parses to `undefined`, the same normalization `privateServerPriceRobux` already applies.

## 0.1.5

### Patch Changes

- retry an idempotent request whose 2xx body arrived truncated, name the failing request on the parse error, and export the `GATEWAY_REJECTED` and `RESPONSE_UNPARSEABLE` transport codes

## 0.1.4

### Patch Changes

- [#536](https://github.com/christopher-buss/bedrock/pull/536) [`5ad2a35`](https://github.com/christopher-buss/bedrock/commit/5ad2a357d6c43ce57c37ca7263124b5c6aa10e12) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Stop rate limiting from delaying every request to an operation slower than one per second

  The client's token bucket computed its burst capacity as `maxPerSecond * intervalMs`, whose units cancel to a constant. Any operation with a limit below one request per second could never accumulate a whole token, so every call slept, including the first call in a fresh process and calls made after an arbitrarily long idle period.

  Creating a Luau execution binary input paid roughly 11 seconds per call against an endpoint that answers in about 140 ms. Publishing or saving a place paid 1 second, listing execution logs 333 ms, and submitting an execution task 500 ms.

  Those four operations now grant the burst the schema documents (5, 30, 45 and 40 per minute respectively) before pacing begins, so an idle client sends immediately. Sustained pacing once the burst is spent is unchanged, as is every operation already at or above one request per second.

## 0.1.3

### Patch Changes

- [#533](https://github.com/christopher-buss/bedrock/pull/533) [`10282c6`](https://github.com/christopher-buss/bedrock/commit/10282c6400796788f50edbc88e8ae868d8b5671e) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Fix place uploads failing on Node 26. Node 26 negotiates HTTP/2 by default,
  where the `connection: close` uploads rely on is a forbidden header that the
  transport drops, and every upload shares one multiplexed session — so a single
  session drop by Roblox's edge gateway failed every place in a deploy at once.
  Uploads now pin HTTP/1.1, using the runtime's own dispatcher class so the
  package stays dependency-free, and fall back to the default transport on any
  runtime that offers no such dispatcher. The HTTP/2 spellings of a dead
  connection (`ERR_HTTP2_STREAM_ERROR`, `ERR_HTTP2_SESSION_ERROR`,
  `UND_ERR_INFO`) also join the retryable transport codes.

## 0.1.2

### Patch Changes

- [#531](https://github.com/christopher-buss/bedrock/pull/531) [`8338686`](https://github.com/christopher-buss/bedrock/commit/833868626954ec6613d2268cbe8b7a8ccc52310b) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Fix intermittent place publish failures caused by HTTP keep-alive connection
  reuse. Roblox's edge gateway discards idle pooled connections faster than a
  pooling `fetch` expects, and a request written into a discarded connection never
  reaches Open Cloud, surfacing as a gateway error page or a socket reset, having
  done nothing. Upload requests now send `connection: close`, and `publish` /
  `save` retry failures that provably never reached Open Cloud (transient
  transport errors and gateway-served responses). They still do not retry 5xx,
  where the duplicate-write risk actually lies.

## 0.1.1

### Patch Changes

- [#525](https://github.com/christopher-buss/bedrock/pull/525) [`e896fed`](https://github.com/christopher-buss/bedrock/commit/e896fed5540d8f70e3077146db3b93840d9e605f) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Enrich API errors with request context and summarize gateway error pages.
  `ApiError` now carries the request `method`, `url`, `elapsedMs`, and an
  allowlisted set of `responseHeaders` (server/edge/request-id headers useful for
  escalation), and an HTML load-balancer error page is captured as a short
  `gatewaySummary` rather than retained whole. Deploy failure messages render this
  context on one line — `on METHOD url after Ns`, a gateway summary in place of a
  raw HTML dump, and any captured headers — and no longer re-dump a response body
  whose message already appears in the status line.

- [#524](https://github.com/christopher-buss/bedrock/pull/524) [`8a28977`](https://github.com/christopher-buss/bedrock/commit/8a28977a6f4bd795f0ca8cfe599f7b12ef882590) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Preserve more diagnostic detail on failures. `RateLimitError` now carries the
  429 response body on `details` (parsed JSON or truncated raw text) plus the
  `statusCode`, mirroring `ApiError`. Deploy, codegen, and config-load failure
  messages now render the underlying `cause` chain instead of only the outermost
  error message, so a wrapped build, emit, write, file-read, or config-function
  throw stays diagnosable from the log alone.

## 0.1.0

### Minor Changes

- [#486](https://github.com/christopher-buss/bedrock/pull/486) [`1a12607`](https://github.com/christopher-buss/bedrock/commit/1a12607219e843249bf3f9e326586a57528577ca) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Adapt rate-limit pacing to the live remaining budget. The client now reads `x-ratelimit-remaining` / `x-ratelimit-reset` off every response and, per API key, spaces requests across the live window (holding until reset once the budget is spent) instead of relying only on the static, schema-derived per-operation limits and reactive 429 handling. A sibling operation on the same key can pre-empt a 429 the static bucket cannot foresee; the static token bucket remains the cold-start and header-absent fallback. `RateLimitError` gains a `remaining` field carrying the exhausted-budget signal from a 429, and multi-window `x-ratelimit-reset` values are parsed correctly.

### Patch Changes

- [#523](https://github.com/christopher-buss/bedrock/pull/523) [`cab8151`](https://github.com/christopher-buss/bedrock/commit/cab81510cd38b108e74f844e802d209fd1c4766b) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Carry the offending response body on `ApiError.details` everywhere it was
  previously dropped: the 401/403 → `PermissionError` upgrade now forwards
  `details`, every `Malformed … response` parser error attaches the body that
  failed validation, and the publish-response JSON decode failure attaches both
  the raw string body and the underlying `SyntaxError` as `cause`.

- [#482](https://github.com/christopher-buss/bedrock/pull/482) [`b36a6eb`](https://github.com/christopher-buss/bedrock/commit/b36a6ebf5ea51f278afe147895041b98001342ad) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Initial 0.1.0 stable release. Graduates the package from the `0.1.0-beta` line to a stable, semver-tracked release with a published changelog and provenance.

- [#492](https://github.com/christopher-buss/bedrock/pull/492) [`05a1b49`](https://github.com/christopher-buss/bedrock/commit/05a1b49f1f3eee5a196bec185ebe6ac76294daa0) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Correct package documentation and publish metadata for the first release: fix the README quick-start examples to match the real config and client APIs, ship a LICENSE file inside each package, and repair the ocale package repository link.

- [#495](https://github.com/christopher-buss/bedrock/pull/495) [`fe924a2`](https://github.com/christopher-buss/bedrock/commit/fe924a29a396cd67c9b3dfa3c33bf52841696540) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Document the introducing version of every public symbol with a JSDoc `@since 0.1.0` tag, now surfaced in the API docs and IDE hovers.
