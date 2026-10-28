# Game-internationalization reported rate-limit buckets

The five operation families report independent 100/minute counters; the probe
does not establish whether successful writes also encounter a shared service
limit.

## Evidence from 2026-10-28

Issue [#587](https://github.com/christopher-buss/bedrock/issues/587) asked
whether the five existing operation keys should collapse into one service-wide
key. The [capture](./capture.json) contains the exact requests and raw response
headers from one existing test API key, with no extra traffic observed in the
sampled counters, and without credentials or response bodies. The run spans
17:38:26.392–17:38:31.480 UTC, entirely within the window ending at
approximately 17:39 UTC.

| Family                           | Method | Status | Reported leading limit |
| -------------------------------- | ------ | ------ | ---------------------- |
| `badge-localization`             | PATCH  | 403    | 100                    |
| `developer-product-localization` | PATCH  | 403    | 100                    |
| `game-pass-localization`         | PATCH  | 400    | 100                    |
| `experience-icon`                | GET    | 200    | 100                    |
| `experience-thumbnails`          | POST   | 400    | 100                    |

Each of the ten family pairs was called in A/B/B/A order. Every pair showed A's
remaining counter falling by one and B's remaining counter falling by one. For
example, badge/product returned remaining values `99, 99, 98, 98`. A single
shared counter would instead return `99, 98, 97, 96`. Every response reported
`x-ratelimit-limit: 100, 500;w=60, 100;w=60`. The probe compares only the
leading counter; it assigns no meaning to the other tokens.

The rejected requests still consumed their own reported counters, as each
family's consecutive calls demonstrate. These observations establish separate
reported meters for the sampled routes. They do not establish a successful
mutation's complete quota contract: badges and products were denied, game-pass
changes targeted the source language, and the thumbnail order was empty in the
source language. No mutation succeeded. Additional limits reached only after
authorization or validation remain untested, as do other methods within each
family, other owners, and OAuth credentials.

The current vendored schema also differs from the issue's original description:
all `/legacy-game-internationalization/v1/**` operations declare
`x-roblox-rate-limits.perApiKeyOwner` and `perOauth2Authorization` as 100 per
minute. They still have no `operationId`. A repeated schema quota declaration
alone does not prove bucket independence; the counter probe supplies that
evidence for the sampled routes.

The five operation keys and both limiter implementations remain unchanged. Their
comments now cite the per-owner schema ceiling and the measured reported
counters, removing the unsupported claim that the leading 100/minute quota is
shared across the entire service.

## Probe interface

`packages/open-cloud/scripts/probe-game-internationalization-buckets.ts` accepts
`ROBLOX_API_KEY` and `PROBE_REQUESTS_FILE`. The latter contains either an array
of request descriptions or a capture object with a `requests` array. Request
descriptions carry `family`, `method`, relative `path`, and an optional JSON
`body`. The checked-in capture provides the exact descriptions used here.

The command, with environment variables already set, is:

```sh
bun packages/open-cloud/scripts/probe-game-internationalization-buckets.ts
```

The probe sends the supplied requests to `https://apis.roblox.com` without SDK
pacing or retries and prints a credential-free JSON capture. Request bodies can
mutate resources: callers must prepare requests against designated test
resources and review their effects first. There must be no concurrent traffic on
the credential. The saved requests intentionally exercise rejected writes and
cannot substitute for a successful-write probe.

Verdicts describe the reported counters only. `allRequestsAccepted: false`
retains the distinction between counter evidence and downstream success. Missing
or malformed headers, 429/5xx responses, changing ceilings, window boundaries,
and unexpected counter movements produce `inconclusive`. Matching concurrent
traffic cannot be distinguished from the probe's own traffic, which is why
credential isolation is a prerequisite.
