# ADR-032: OAuth Credentials in ocale and core

**Date:** 2026-10-22 **Status:** Accepted

Decision Makers: Maintainer  
Tags: security, auth, ocale, core, breaking-change

## Context

ADR-007 made Open Cloud API keys the only **Credential** and rejected OAuth 2.0
as the primary method, because bedrock was a CI tool with no user to log in.
That still holds for CI. It does not hold for a website built on ocale and core
that acts for many Roblox users: each user grants the site access to their own
experiences through OAuth, and the site cannot ask each user for an API key.

A consumer has already run `provision()` on an OAuth bearer token through an
injected `HttpClient`. Game-pass and developer-product create, no-op and update
all worked. To send `Authorization: Bearer` they had to deep-import ocale's
internal fetch client, and the rate-limit queue was keyed on a placeholder
`apiKey`.

Facts about Roblox OAuth that shaped the decisions below, from the
[operation survey](https://github.com/christopher-buss/bedrock/issues/681) and
the live probes ([1](https://github.com/christopher-buss/bedrock/issues/682),
[2](https://github.com/christopher-buss/bedrock/issues/697),
[3](https://github.com/christopher-buss/bedrock/issues/721),
[4](https://github.com/christopher-buss/bedrock/issues/722)):

- Access tokens last 15 minutes. Refresh tokens last 90 days, are single-use,
  and rotate on every refresh. There is no `client_credentials` grant.
- Roblox keeps one authorization per (user, app). A new authorize replaces it
  and revokes the old refresh token.
- Every Operation bedrock binds accepts a bearer token with the same limits as
  an API key, except place publish (and save), Luau execution and memory store.
  On those, a bearer returns 401 "Missing API Key Header".
- The OAuth rate-limit bucket is per (user, app), separate from any API key, and
  survives a refresh.
- Scope failures return 403 (v1 code 0, v2 `PERMISSION_DENIED`). An expired
  token returns 401 "Invalid Token.", but only 48 to 71 s after `exp`.
- A revoke, or removing the app in account settings, kills the refresh token at
  once but does not shorten a live access token on v2 and legacy endpoints.
  After an app removal, v1 endpoints return a stable 502 "Scope authorization
  failed." until `exp`.
- v1 reads and v2 writes check the universe grant (403 "Resources not
  authorized."). v2 and legacy reads, and the legacy name-description write, do
  not.

## Decision

OAuth becomes a second **Credential** kind next to the API key, in both ocale
and core. The API key stays the primary method and the method for CI.

### ocale

**Shape (breaking).** `credential: Credential` replaces `apiKey` on
`OpenCloudClientOptions` and `RequestOptions`. Consumers write object literals;
there are no factory functions.

```ts
type Credential =
	| { apiKey: string; kind: "apiKey" }
	| {
			getAccessToken: (context: {
				signal: AbortSignal;
			}) => Promise<string> | string;
			identity: string;
			kind: "oauth";
	  };
```

**Credential identity.** For OAuth the caller supplies `identity`; ocale cannot
derive a stable one from tokens that rotate. For an API key, ocale derives it
and never exposes it. The identity, never a token value, keys the rate-limit
queue and the budget gate.

**Provider timing.** ocale calls `getAccessToken` once per transport attempt,
after every admission wait and immediately before the send. A guided wait can
outlast a token read once per logical call. The provider must return a token
valid for at least 60 s and must throw when it cannot.

**Transport.** `RequestConfig.credential` carries the resolved credential
(`{ kind: "apiKey"; apiKey }` or `{ kind: "oauth"; accessToken }`) and the
transport chooses the header. The request-header merge skips `x-api-key` and
`authorization`, so a request cannot override the configured credential. This
breaks custom transports.

**Errors.**

- A throwing provider returns `CredentialError`, with the provider error as
  `cause`. No retry.
- A non-gateway 401 on an OAuth credential returns `CredentialRejectedError`
  carrying `identity`. No refresh, no retry. A 502 whose body says "Scope
  authorization failed." on an OAuth credential is treated the same; every other
  502 keeps the retry rules of ADR-010, so a create is still never retried.
- A 403 stays `PermissionError`. On an OAuth credential its message adds a hint
  that the grant may not include the scope or the universe.

**API-key-only Operations.** Each Operation spec carries a flag for Operations
that accept only an API key. An OAuth call to one returns an error without
sending a request, in place of Roblox's 401.

**Refresher.** ocale exports
`createOAuthTokenRefresher({ clientId, refreshToken, clientSecret?, onRotate, fetch? })`.
It returns a `getAccessToken` function; the caller still writes the Credential
literal and its `identity`.

- The first call always refreshes; later calls refresh when under 120 s remain,
  measured from the local clock at receipt plus `expires_in`.
- `onRotate` is required. The new access token is not used until `onRotate`
  resolves with the new refresh token saved. If `onRotate` throws, the call
  fails with `CredentialError`, and the helper keeps the new pair in memory and
  calls `onRotate` again on the next call, without another refresh. The old
  refresh token is already spent, so it is never sent again.
- On a network error, 5xx or 429 it returns the current token while 60 s or more
  remain, and throws under 60 s.
- One refresh at a time per helper. A caller's `signal` never cancels a refresh
  in flight, because an aborted request can still consume the refresh token.
- A refused refresh throws `TokenRefreshError` (surfacing as
  `CredentialError.cause`) with the OAuth `error` code. After `invalid_grant` it
  stays failed and sends no further request.

**Provider patterns.** Two are supported:

1. `createOAuthTokenRefresher`, for one process that owns the refresh token.
2. A custom `getAccessToken` that reads a token something else refreshes, for
   example an auth library on a server with many instances.

The rule for both: **one refresher per refresh token.** Two refreshers on one
single-use token make one of them fail with `invalid_grant`. The helper takes no
lock across processes.

**Fetch seam.** `createFetchHttpClient({ fetch? })` becomes public, so a
consumer wrapping `fetch` never deep-imports `internal/`.

**Token hygiene.** No payload ocale builds (error, hook argument) holds a token,
enforced by a canary test across every error kind and hook. Outside that
guarantee, and documented on `credential` and `HttpClient`: a custom
`HttpClient`, `NetworkError.cause` from a wrapped `fetch`,
`CredentialError.cause` from the provider, and `ApiError.details` from a Roblox
body.

### core

- `deploy`, `provision`, `publish` and `buildDefaultRegistry` take one optional
  `credential: Credential`, passed to every ocale client core builds.
- `credential` and `registry` are mutually exclusive in the option types.
- A given `credential` wins over `BEDROCK_API_KEY`: when `credential` is given,
  core does not read the environment. Without it, core reads `BEDROCK_API_KEY`
  as today, and with neither, `MissingCredentialError` is unchanged.
- No OAuth token from the environment, the config file or the CLI. A token
  expires in 15 minutes and needs an `identity`, so an OAuth Credential comes
  only from code. `--api-key` is unchanged.
- One Credential per run, not an OAuth credential plus an API key routed by
  Operation.
- With an OAuth credential, core checks before the first write that the run
  needs no API-key-only Operation, and fails the whole run if it does: after the
  plan for `deploy` and `publish`, and from the buildable places for a codegen
  deploy, whose place Operations are known only after the build.

### Native CLI OAuth (`bedrock login`)

Deferred. When built, it uses a per-user app, a PKCE login and a local token
store. The only revisit trigger is place publish accepting an OAuth bearer
token; until then `login` cannot cover a deploy that publishes places, and CI
needs an API key anyway. The PKCE listener and code exchange wait with it.

## Consequences

### Positive

- A website can run ocale and core for many users, each with their own grant,
  identity and rate-limit bucket, without deep imports.
- An OAuth run that would publish a place fails before it writes anything.
- Tokens stay out of every error and hook payload by construction.

### Negative

- Breaking for every consumer: `apiKey` becomes `credential`, and custom
  transports read `RequestConfig.credential`. Pre-1.0, this is a `minor` bump.
- A lost grant (a new authorize, a revoke, an app removal) is a normal path for
  an OAuth consumer. The caller must detect `CredentialRejectedError`, or
  `TokenRefreshError` with `invalid_grant`, and ask the user to consent again.
- The refresher is safe in one process only. Multi-instance consumers must bring
  their own refresher.

## Alternatives Considered

### Keep `apiKey` and add `credential` beside it

Two names for one job, and an override rule between them. `RequestConfig` breaks
anyway.

### Widen `apiKey` to `string | () => string`

The name would lie: a function sends `Authorization: Bearer`, and a vault-backed
API key is a function too.

### Refresh and retry on 401

Roblox lists scope failures as 403 and sends no `WWW-Authenticate`. The 401s
seen in practice (a revoked grant, an API-key-only Operation) are not fixed by a
refresh. Concurrent 401s forcing refreshes would burn the single-use refresh
token, and no source says a 401 request went unprocessed, so replaying a create
is unsafe.

A narrower one-time replay is possible later without a break: an optional
`rejectedToken` in the provider context, only on a non-gateway 401, only on
idempotent methods, outside `maxRetries`. It is not built now because Roblox
accepts tokens past `exp` and providers must return 60 s of validity, so it
would only help providers that break their contract.

### Mixed credentials in one run

Core could route place publish to an API key and the rest to OAuth. That means
two identities, two queues, a 403 from either, and a routing table that dies the
day place publish accepts OAuth. A caller with an API key can already do
everything with it alone. `credential` can widen to
`Credential | { oauth; apiKey }` later without a break.

### OAuth token from environment, config or CLI flag

A 15-minute token cannot be refreshed by core, and a committed config is the
wrong home for a per-run secret.

### Shared reviewed bedrock app for `bedrock login`

Needs a Roblox review, and the maintainer would own policy compliance for every
user. Not chosen.

### CI write-back of the rotated refresh token

Parallel jobs race on one single-use token, and a lost write needs a human to
log in again. Rejected; CI uses an API key.

## Related Decisions

- ADR-007: amended to point here.
- ADR-009: every call keeps returning a `Result`; credential failures are new
  error kinds, not throws.
- ADR-010: the rate-limit queue is keyed by **Credential identity**.

## References

- [Wayfinder map: OAuth credentials for ocale and core](https://github.com/christopher-buss/bedrock/issues/680)
- [Roblox OAuth 2.0 reference](https://create.roblox.com/docs/cloud/auth/oauth2-reference)
- [Roblox Open Cloud errors](https://create.roblox.com/docs/cloud/reference/errors)
