# @bedrock-rbx/ocale

## 0.4.0

### Minor Changes

- **Breaking:** a response body that a resource parser rejects now returns `UnexpectedResponseError` instead of `ApiError`. The new class extends `OpenCloudError`, not `ApiError`, so `instanceof ApiError` no longer matches a malformed response; branch on `UnexpectedResponseError` instead. It carries the raw body in `details`, the `statusCode`, and the request `method`, `url`, and allowlisted `responseHeaders`, so a consumer can tell a likely ocale bug apart from an API rejection.

  The bedrock game-pass and universe drivers also return `UnexpectedResponseError`, not `ApiError`, when a response lacks `iconAssetId` or `rootPlaceId`. The bedrock CLI shows the body, the failing call, and the response headers for an `UnexpectedResponseError`, as it does for an `ApiError`.

- Luau-execution `pollUntilDone` and `runUntilDone` now bound every in-flight submit and poll request by the remaining `timeoutMs` budget, through the request `deadlineMs`. **Breaking:** when the budget runs out, the call returns `PollTimeoutError` carrying the last observed task (with the `RequestDeadlineExceededError` as `cause`), where a request that hung past its own timeout used to return `NetworkError`. For `runUntilDone` the budget now opens before the submit and covers it. A caller-supplied `signal` still wins with `PollAbortedError`. The places client's `luauExecution` namespace now also derives its request `timeout` from the budget.

- Remove the `apiKey` client and request option. Pass `credential: { kind: "apiKey", apiKey }` instead; `credential` is now required on client options. Custom transports read `RequestConfig.credential`, which replaces `RequestConfig.apiKey`.

- Creating a badge no longer fails on the response Roblox actually sends. The awarder comes back without a name and with its type as the string `"Place"`, so `BadgeAwarder.name` is now `string | undefined`.

- Listing experience icons no longer fails for a universe still on the default icon. Roblox sends a null image id for that icon, so `ExperienceIcon.imageId` is now `string | undefined`.

- Stop sending `isRegionalPricingEnabled` and `storePageEnabled`, which Roblox retired on 2026-07-20. `isRegionalPricingEnabled` is removed from the create and update parameters of developer products and game passes; managed pricing replaces regional pricing. `storePageEnabled` is removed from `UpdateDeveloperProductParameters` and from the parsed `DeveloperProduct`; Shop listing replaces the external store page. Remove these fields from your calls.

### Patch Changes

- Return `CredentialRejectedError` with the OAuth `identity` when Roblox refuses an OAuth token: a non-gateway 401, or a 502 whose body says "Scope authorization failed.". The call is not retried. An OAuth 403 stays `PermissionError`, and its message now says the grant may not include the scope or this universe. API-key behavior does not change.

- `createFetchHttpClient` takes an optional `{ fetch }`, so you can wrap `fetch` without importing internal modules.

- An `UnexpectedResponseError` from an ocale client now ends its message with a line that links to a prefilled ocale bug report. The link is also on the new `reportUrl` property. It holds the message, status, failing call and response headers, but not the body. Set `reportHint: false` on the client options to leave the line out, for example when your tool renders its own failure output. The bedrock CLI ends an unexpected-response failure with the same link.

- Accept an OAuth `credential` (`{ kind: "oauth", identity, getAccessToken }`). The client calls `getAccessToken` once per attempt, after every admission wait, and sends `Authorization: Bearer`. A failing provider returns the new `CredentialError` and spends no retry. Request headers can no longer set `authorization`.

- Add createOAuthTokenRefresher, which returns a getAccessToken for one refresh token in one process, and TokenRefreshError.

- Pace each OAuth credential on its own rate-limit queue and budget, keyed by its `identity`. A token rotation keeps the queue, and an OAuth identity never shares a queue with an equal API key.

- Add `RobloxLocalizationKey` and `isRobloxLocalizationKey` to `@bedrock-rbx/ocale/locales` for validating Roblox locale strings.

- Developer product and game pass create/update calls accept `isManagedPricingEnabled`.

- Fail requests locally with `RateLimitWaitRefusedError` while an operation is locked out by a 429 asking for more than 60 seconds, until the server's reset instant, instead of sending each one. A Luau submit refused for place capacity is not locked out. A 429 asking for 60 seconds or less now holds later requests on its operation until the wait ends, whatever `x-ratelimit-remaining` reports.

- Add `restarts.restartOutdated`, which restarts only the outdated servers of the given places, reports the outcome per place, and forecasts once more if a place loses its last outdated server before the restart.

- Add `RateLimitError.source`, which reports whether the edge gateway or the service behind it refused a 429, or `unknown` without positive evidence.

- Return CredentialNotSupportedError for an OAuth call to an operation that accepts only an API key (place publish and save, Luau execution, memory stores). No request is sent.

## 0.3.4

### Patch Changes

- Rate-limited bursts now finish instead of failing: requests queued behind a rate-limit reset are released at the server's reported window capacity, and a 429 that names its wait is waited out without spending `maxRetries`. A named wait over 60 seconds fails at once with the new `RateLimitWaitRefusedError`, which carries the requested wait and the 429's evidence.

## 0.3.4-beta.1

## 0.3.4-beta.0

## 0.3.3

### Patch Changes

- Add `UniversesClient.restartServers` and the `restarts` operation group (`launch`, `list`, `forecast`) to restart a universe's live servers and track the restart.

- Read error codes and messages from Cloud v2 `code` bodies and server-management error bodies, so `ApiError.code` is set for v2 errors and sentence-valued `error` fields and validation ProblemDetails land on the message.

## 0.3.2

### Patch Changes

- preserve machine-readable 429 evidence on RateLimitError

- add opt-in bounded capacity admission for Luau task submissions

- Bound logical calls and all SDK-managed waits with per-request absolute deadlines.

## 0.3.1

### Patch Changes

- Pace Luau Execution task submits at a place's head to 5 requests per minute, the limit Roblox now enforces, down from 40. Head and version-pinned submits still use separate queues.

- Honor Retry-After on 429 responses and wait for x-ratelimit-reset only when the reported request quota is exhausted, so capacity refusals retry promptly.

- Expose Ocale's default fetch-backed HTTP transport so consumers can decorate it without reproducing request and error semantics.

- Allow every Open Cloud resource request to be cancelled across queueing, budget waits, retries, and in-flight transport.

- Expose request-scoped admission-wait lifecycle events for operation queues, reported budgets, and retry delays.

- Accept the `STATE_UNSPECIFIED` task state and `ERROR_CODE_UNSPECIFIED` error code on Luau Execution tasks. Roblox's OpenAPI schema declares both, and the parser previously rejected them as malformed responses. Both values are now passed through verbatim; pollers keep polling on `STATE_UNSPECIFIED`.

- Accept the `MESSAGE_TYPE_UNSPECIFIED` log message type on Luau Execution task logs. Roblox's OpenAPI schema declares it, and the parser previously rejected the whole log page as a malformed response over a single message carrying it. The value is now passed through verbatim on `LogMessage.messageType`.

## 0.3.0

### Minor Changes

- Read the Open Cloud v2 `error` field when building an `ApiError`, so canonical
  statuses such as `NOT_FOUND`, `INVALID_ARGUMENT` and `PERMISSION_DENIED` reach
  `ApiError.code` instead of being reachable only through `ApiError.details`. The
  message of a v2 error now carries the usual `(code NOT_FOUND)` suffix.

  `code` also moves onto the `OpenCloudError` base, so a caller holding the error
  that `Result.err` is typed as can branch on it without first narrowing to a
  subclass. `ValidationError.code` keeps its narrower closed union.

  Breaking, at the type level only: `OpenCloudError` used to be structurally
  identical to `Error`, so any `Error` satisfied it. It now carries `code`, and a
  bare `Error` no longer does. Pass a real SDK error, or widen the parameter to
  `Error`.

## 0.2.3

## 0.2.2

## 0.2.1

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
