# Luau Execution task read-cost spike

Does one `Cloud_GetLuauExecutionSessionTask` call cost 4 units of its `200;w=60`
window, as the
[deadline-overrun spike](https://github.com/christopher-buss/bedrock/pull/637)
evidence appeared to show? If so, Ocale's 200/min pacing for that operation and
its header-primed budget gate, which reserves one unit per send, both overshoot
by 4x.

## Question

The deadline-overrun evidence
(`docs/spikes/luau-deadline-overrun/evidence/mu90nt6i-2bbf65a8.jsonl`) recorded
`x-ratelimit-remaining` falling 127, 123, 119, 117, 112, 108 across consecutive
single GETs polled once per second. Read as a per-call cost, that is 4 units per
read and an effective ceiling of about 50 reads per minute, close to the 45 the
human-readable docs state.

The same evidence carries a second signal. The step size tracks elapsed time,
not call count: a 0.45 s gap cost 2, a 1.15 s gap cost 4, a 1.98 s gap cost 7.
Between runs 1 and 2 the window reset to 200 and had already lost 111 units
before run 2's first read. A counter draining at about 3.3 units per second
while the probe sends nothing is what a second consumer on the same key or IP
looks like, and 3.3 per second is exactly 200 per minute.

## Method

[`probe-luau-task-read-cost.ts`](../../../packages/open-cloud/scripts/probe-luau-task-read-cost.ts),
whose arithmetic lives in the unit-tested
[`luau-task-read-cost.ts`](../../../packages/open-cloud/scripts/luau-task-read-cost.ts).
Raw `fetch`, no SDK, no pacing, no retries. Two phases separate per-call cost
from background drain:

| Phase   | Traffic                                 | Measures                          |
| ------- | --------------------------------------- | --------------------------------- |
| `burst` | N sequential GETs on one task, no delay | median counter drop per call      |
| `idle`  | one pause with no traffic, then one GET | drop across the pause, in units/s |

The burst is short enough that an external drain of a few units per second
cannot masquerade as per-call cost. The idle read's own cost is subtracted from
the pause drop.

```bash
ROBLOX_TEST_PLACE_ID=15098004467 bun packages/open-cloud/scripts/probe-luau-task-read-cost.ts
```

```bash
ROBLOX_TEST_PLACE_ID=15098004467 ROBLOX_TEST_TASK_PATH=<path from run 1> PROBE_READS=30 PROBE_IDLE_MS=30000 bun packages/open-cloud/scripts/probe-luau-task-read-cost.ts
```

Bun loaded `ROBLOX_API_KEY` and `ROBLOX_TEST_UNIVERSE_ID` from `.env`. Run 1
submitted one `return 1` task at head; run 2 reused it and spent no submit
budget.

## Findings

Ran on 2026-09-20 (UTC) against universe `5202621917`, place `15098004467`,
version `6`, one API key and one IP, no other process on either.

| Run                                       | Reads | Burst deltas | Units per read | Burst drop | Idle pause | Idle drain |
| ----------------------------------------- | ----- | ------------ | -------------- | ---------- | ---------- | ---------- |
| [run 1](./evidence/run-1-fresh-task.log)  | 20    | 1 × 19       | 1              | 8.5 /s     | 10 s       | 0 /s       |
| [run 2](./evidence/run-2-reused-task.log) | 30    | 1 × 29       | 1              | 6.1 /s     | 30 s       | 0 /s       |

Every response read `x-ratelimit-limit: 200, 200;w=60, 200;w=60`. The counter
fell by exactly 1 on every one of 48 consecutive reads, at a burst rate more
than twice the 3.3 per second Ocale would pace at, and did not move across 40 s
of silence.

**A task read costs 1 unit. The effective ceiling is 200 reads per minute, as
the vendored schema states and as Ocale already paces.** The deadline-overrun
observation "each task read costs 4 units of a 200 window" is a misreading of
that evidence: the probe was sharing its key or IP with another consumer that
was itself running at the 200/min ceiling for the whole 23:26 to 23:29 UTC span,
and its 1/s polls landed on a counter something else was draining.

## Interpretation

No change to `GET_OPERATION_LIMIT` in
[operations.ts](../../../packages/open-cloud/src/domains/cloud-v2/luau-execution-tasks/operations.ts)
and no change to the budget gate's one-unit `reserve` are warranted. Both match
the server. The gate re-primes from every response, so a concurrent consumer on
the same key shows up as a lower `remaining` on the next read and is paced
around rather than run into a 429.

The lesson for later probes is procedural: a counter read from a paced poller
cannot distinguish per-call cost from concurrent drain. Measure cost with a
tight burst and drain with a silent pause, and record which other processes hold
the key during the run.

## Related

- [Deadline-overrun spike](https://github.com/christopher-buss/bedrock/pull/637),
  the evidence that raised the question.
- [Submit rate limits spike](../luau-submit-rate-limits/README.md), the earlier
  header-reading probes on the same place.
- [`probe-luau-execution-rate-limit.ts`](../../../packages/open-cloud/scripts/probe-luau-execution-rate-limit.ts),
  the 2026-05-24 probe that established the 200/min ceiling and fixed-window
  shape for this operation.
