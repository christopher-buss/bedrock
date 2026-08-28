# Luau Execution submit rate limits spike

Independent reproduction of
[christopher-buss/bedrock#541](https://github.com/christopher-buss/bedrock/issues/541):
whether the two Luau Execution submit URL shapes share one rate-limit bucket.

## Question

`SUBMIT_OPERATION_LIMIT` in
[operations.ts](../../../packages/open-cloud/src/domains/cloud-v2/luau-execution-tasks/operations.ts)
paces both submit shapes from a single 40 requests/minute queue, because
`SUBMIT_HEAD_SPEC` and `SUBMIT_VERSION_SPEC` in
[specs.ts](../../../packages/open-cloud/src/domains/cloud-v2/luau-execution-tasks/specs.ts)
share the same `operationLimit` reference. The JSDoc states that Roblox
attributes both URL shapes to the same per-minute quota. If that is wrong, the
version-pinned shape is paced at several times its real ceiling.

## Method

Two probe scripts, both reading live response headers rather than inferring from
throttle timing:

| Script                                | Answers                                              |
| ------------------------------------- | ---------------------------------------------------- |
| [bucket-separation][separation-probe] | Are the buckets separate, and what are the ceilings? |
| [window-shape][window-probe]          | Is enforcement a fixed window or a sliding average?  |

Run either against a real place:

```bash
ROBLOX_API_KEY=<key> ROBLOX_TEST_UNIVERSE_ID=<id> ROBLOX_TEST_PLACE_ID=<id> bun packages/open-cloud/scripts/probe-luau-submit-bucket-separation.ts
```

The separation probe submits once at head, three times at the pinned version,
then once more at head. Separate buckets predict head's `x-ratelimit-remaining`
dropping by 1 across the pinned traffic; a shared bucket predicts 4.

The window-shape probe drains the 5/minute pinned bucket to a 429, keeps
submitting across the window boundary, and reports the step where `remaining`
increases. A sliding window can only return budget for calls older than 60
seconds, so a counter restored to its full ceiling while recent calls are still
inside the trailing minute rules a sliding window out.

## Findings

Reproduced on 2026-08-28 against universe `5202621917`, place `15098004467`,
head version 6, on an API key and IP unrelated to the report in #541. Every
result below reproduced across three separate runs.

### The buckets are separate, with different ceilings

| Shape                                                     | `x-ratelimit-limit` |
| --------------------------------------------------------- | ------------------- |
| head, `.../places/{placeId}/luau-execution-session-tasks` | 40                  |
| version-pinned, `.../versions/{versionId}/...`            | 5                   |

```text
head #1     shape=head   status=200 limit=40 remaining=39 reset=59
pinned #1   shape=pinned status=200 limit=5  remaining=4  reset=57
pinned #2   shape=pinned status=200 limit=5  remaining=3  reset=54
pinned #3   shape=pinned status=200 limit=5  remaining=1  reset=52
head #2     shape=head   status=200 limit=40 remaining=38 reset=50
```

Head's `remaining` moved 39 to 38 across three pinned submits: only the reader's
own head call. Pinned traffic does not draw on head budget, so the ceilings are
additive, 40/minute head plus 5/minute pinned.

The vendored OpenAPI already encodes this. The head operation
(`Cloud_CreateLuauExecutionSessionTask__Using_Universes`) carries
`x-roblox-rate-limits.perApiKeyOwner.maxInPeriod: 40`; the version-pinned
operation (`..._Using_Universes_Places`) carries `5`. Both operations' prose
descriptions claim "5 calls per minute per API key owner", which is wrong for
head and is the likely source of the single-queue belief.

### Enforcement is a fixed 60 second window

```text
submit #6    status=429 limit=5 remaining=0 reset=3  retry-after=5 envoy=true
submit #7    status=200 limit=5 remaining=4 reset=53 retry-after=(none) envoy=false
```

The counter returned to its full ceiling of 5 in one step at the boundary, while
a submit from 1.5 seconds earlier was still inside the trailing minute. Budget
does not drip back per aged-out call. `x-ratelimit-reset` counts down to that
boundary on every response, including successes, regardless of traffic.

### Every response carries the live budget

`x-ratelimit-limit`, `x-ratelimit-remaining`, and `x-ratelimit-reset` are
present on 200s as well as 429s, on both shapes. A client can track the server's
own counter instead of modelling the quota from a hardcoded constant.

Note that `fetch` joins the two headers Roblox sends under each name, so
`x-ratelimit-limit` arrives as `40, 45;w=60, 40;w=60, 70000`. The leading token
is the binding operation quota; the trailing `70000` is a separate global one.

### The quota 429 is an edge-proxy rejection

```text
status=429 remaining=0 reset=44s retry-after=5s x-envoy-ratelimited=true
body: {"errors":[{"code":0,"message":""}]}
```

A quota 429 carries `x-envoy-ratelimited: true`, `remaining: 0`, and a body with
no `RESOURCE_EXHAUSTED` code. `retry-after` is a constant 5 seconds and
understates the real wait by up to an order of magnitude; `x-ratelimit-reset`
holds the true time to the window edge. This matches the third-party observation
in #541 that the ten-incomplete-tasks and concurrent-submit caps return a
different 429 shape, with `code: "RESOURCE_EXHAUSTED"` and `remaining` still
non-zero.

## What this means for the fix

The single shared `SUBMIT_OPERATION_LIMIT` is wrong. The pinned shape is paced
at eight times its real ceiling, on the optimistic-concurrency retry path, which
is exactly where contention makes 429s most likely.

1. Give each submit spec its own operation limit, sourced from its own
   operation's `x-roblox-rate-limits` rather than from head's. Head keeps
   40/minute under `luau-execution-tasks.submit`; the pinned shape needs its own
   5/minute queue under a distinct operation key, or the two will keep sharing
   one queue in `RateLimitQueue`.
2. A limiter reasoning in sliding averages mis-predicts at window edges, since a
   60 second view straddling two fixed windows can legitimately observe 45 head
   or 8 pinned calls.
3. The header-primed budget gate already reads the server's counter, but keys
   one tracker per API key. These two operations report different `remaining`
   values on one key at the same instant, so a pinned reading gates head submits
   and the next head reading erases it. The gate needs a tracker per operation
   to hold both windows.

## Related

- [#541](https://github.com/christopher-buss/bedrock/issues/541), the issue this
  spike answers.
- [#535](https://github.com/christopher-buss/bedrock/issues/535), the burst
  capacity defect in `RateLimitQueue`. Same subsystem, independent bug.
- [`probe-luau-execution-rate-limit.ts`](../../../packages/open-cloud/scripts/probe-luau-execution-rate-limit.ts),
  the earlier probe that settled the GET operation's ceiling and window shape.

[separation-probe]:
	../../../packages/open-cloud/scripts/probe-luau-submit-bucket-separation.ts
[window-probe]:
	../../../packages/open-cloud/scripts/probe-luau-submit-window-shape.ts
