# Luau Execution internal-timeout probe

Serial reproduction attempt for
[christopher-buss/bedrock#625](https://github.com/christopher-buss/bedrock/issues/625):
whether Roblox's mitigated January 2026 Luau Execution incident has returned.
The incident's terminal signature is a task ending `FAILED / INTERNAL_ERROR`
with the exact message `Task timed out due to an internal error`. Roblox
acknowledged it on 2026-01-14 and reported it mitigated on 2026-01-15 in the
[Developer Forum thread][incident].

## Question

Does a trivial task, submitted serially against one pinned place version with no
client retries, ever end in that exact terminal error? The first goal is to name
the exact terminal state, code, and message of every accepted task. It is not a
stress test.

## Method

One probe script, [`probe-luau-internal-timeout.ts`][probe], talking raw Open
Cloud HTTP:

- Task body is only `return "ok"`: no binary input, no output logging, no
  MemoryStore, no requested timeout, no result relay.
- Every task runs at one pinned version. The version comes from
  `ROBLOX_TEST_PLACE_VERSION_ID`, or from one head submit whose task is not
  polled and not counted; head targeting is a separate dimension.
- Submits are serial. Each accepted task is polled to a terminal state or the
  observation bound before the next submit.
- No automatic retries. A 429 is recorded as a rate-limited rejection outside
  the denominator, and the probe holds for `x-ratelimit-reset` before trying
  again. Pacing reads the live `x-ratelimit-*` headers on every reply.
- Explicit caps: 20 accepted tasks by default, 40 submit attempts, 330 s of
  observation per task. Raising a cap is the explicit follow-up budget; hard
  ceilings stop the run scaling into a soak test.
- The run stops on the first exact match and preserves that task resource.
- Every run is one run group, named by `PROBE_GROUP`. Groups are never pooled
  into one failure rate. A workload variant is a separate group in a separate
  run, never mixed into the trivial baseline.

Run it against an isolated place:

```bash
PROBE_ISOLATED_PLACE=1 ROBLOX_API_KEY=<key> ROBLOX_TEST_UNIVERSE_ID=<id> ROBLOX_TEST_PLACE_ID=<id> bun packages/open-cloud/scripts/probe-luau-internal-timeout.ts
```

The key needs `universe.place.luau-execution-session:write` and `:read`. The
opt-in is required because the probe submits real tasks against the place.

| Variable                       | Default              | Ceiling |
| ------------------------------ | -------------------- | ------- |
| `ROBLOX_TEST_PLACE_VERSION_ID` | discovered from head | n/a     |
| `PROBE_ACCEPTED_TASKS`         | 20                   | 200     |
| `PROBE_MAX_SUBMITS`            | 40                   | 400     |
| `PROBE_OBSERVATION_MS`         | 330000               | 3600000 |
| `PROBE_POLL_INTERVAL_MS`       | 2000                 | 60000   |
| `PROBE_MAX_POLL_FAILURES`      | 5                    | 20      |
| `PROBE_GROUP`                  | `trivial-baseline`   | n/a     |
| `PROBE_SCRIPT`                 | `return "ok"`        | n/a     |
| `PROBE_OUTPUT_DIR`             | OS temp dir          | n/a     |

Exit code is 0 for a bounded green sample, 2 when the exact signature was
observed, and 1 for a configuration error or an aborted run.

## Classification

Every accepted task lands in exactly one bucket. Only the first is the
regression.

| Bucket                 | Terminal observation                                | Meaning                                                 |
| ---------------------- | --------------------------------------------------- | ------------------------------------------------------- |
| `internal-timeout`     | `FAILED`, `INTERNAL_ERROR`, exact incident message  | Probable regression; stops the run                      |
| `internal-error-other` | `FAILED`, `INTERNAL_ERROR`, any other message       | Retained and reported as a separate signature           |
| `deadline-exceeded`    | `FAILED`, `DEADLINE_EXCEEDED`                       | Requested script timeout, not this bug                  |
| `failed-other`         | `FAILED`, any other code                            | Retained, not this bug                                  |
| `complete`             | `COMPLETE`                                          | Green                                                   |
| `cancelled`            | `CANCELLED`                                         | Retained                                                |
| `observation-bound`    | still `QUEUED` or `PROCESSING` at the bound         | Routed to the timeout/state ticket; not an internal one |
| `poll-failed`          | consecutive unreadable or non-2xx polls hit the cap | Request-path failure while watching; retained           |

Submits that create no task are rejections, not tasks: a quota 429 is
`rate-limited`, and a transport failure, gateway error, or reply without a task
path is `request-path`. Neither enters the denominator.

## Artifacts

Each run writes three files under `PROBE_OUTPUT_DIR/<group>-<start time>/`:

| File               | Contents                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `private-run.json` | Every exchange: task paths, timestamps, all response headers, bodies, and the head discovery    |
| `public-run.json`  | The same run with universe, place, version, session, and task ids replaced and headers filtered |
| `public-report.md` | The rendered verdict, per-bucket counts, and, on a match, the regression contribution           |

The API key is never written; only response headers are captured.

## Reporting

A green sample reports `0/N` and the one-sided 95% exact binomial upper bound on
the true rate, which for `0/20` is about 14%. That bounds what the sample can
claim. It is not evidence that the incident cannot recur, and the report never
says so.

An exact match is formatted as a regression contribution: the incident link, the
task path, submit and terminal timestamps, the script, and the terminal body.
Post the public artifact on the [incident thread][incident] or a linked
regression report, and keep the private one for Roblox staff.

## Findings

Not yet run. Running needs an isolated place and the opt-in above, which are the
maintainer's call. Record each run group here with its date, target, caps, and
the public report's verdict line.

## Related

- [#625](https://github.com/christopher-buss/bedrock/issues/625), the issue this
  spike answers.
- [Luau Execution submit rate limits spike](../luau-submit-rate-limits/README.md),
  which established the header-driven pacing this probe reuses.
- [`probe-luau-execution-rate-limit.ts`](../../../packages/open-cloud/scripts/probe-luau-execution-rate-limit.ts),
  which settled the task GET quota the polling loop stays under.

[incident]:
	https://devforum.roblox.com/t/luau-execution-api-random-internal-timeouts/4256345
[probe]: ../../../packages/open-cloud/scripts/probe-luau-internal-timeout.ts
