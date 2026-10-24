# Luau Execution stale-task capacity spike

Harness and protocol for
[christopher-buss/bedrock#626](https://github.com/christopher-buss/bedrock/issues/626):
whether a Luau Execution task that has outlived its deadline but still reports
`PROCESSING` holds one of a place's ten documented incomplete-task slots.

## Status

**Blocked. Not yet run.** The stale-place trial needs a naturally stuck task on
a dedicated disposable place, which none of the reproduction tickets
([#622](https://github.com/christopher-buss/bedrock/issues/622),
[#623](https://github.com/christopher-buss/bedrock/issues/623),
[#624](https://github.com/christopher-buss/bedrock/issues/624)) has produced.
The harness must not manufacture one: a stuck task is exactly the thing whose
cost this spike measures, and one may be permanent.

The clean-place control can run at any time on any disposable place. The
findings section below stays empty until the first run.

## Question

Roblox caps each place at ten incomplete Luau Execution tasks and rejects the
eleventh. If a stale `PROCESSING` task is counted, every stuck task permanently
shrinks that place's capacity, which is a second Roblox bug distinct from the
state-machine one. If it is not counted, there is no capacity bug to report.

## Method

One script, [probe-luau-execution-capacity][probe], runs the same submission
schedule in two modes and classifies each response.

```bash
ROBLOX_API_KEY=<key> ROBLOX_TEST_UNIVERSE_ID=<id> ROBLOX_TEST_PLACE_ID=<id> bun packages/open-cloud/scripts/probe-luau-execution-capacity.ts
```

Set `ROBLOX_STALE_TASK_PATH=universes/…/tasks/<id>` to run the stale-place
trial; leave it unset for the clean-place control. The key needs both
`universe.place.luau-execution-session:read` and `:write`. The place must have
no other submitters for the duration of the run.

### Filler tasks

Every submit is the same finite, known-good script under a task deadline:

```lua
task.wait(120) return "filler"
```

with `timeout: "150s"`. A filler holds its slot for two minutes and returns
`COMPLETE`; one that fails to return still hits the deadline and returns
`FAILED / DEADLINE_EXCEEDED`. Either way it reaches a terminal state, and the
harness polls every accepted filler until it does (or until 60 s past its
deadline) before exiting. A run leaves nothing behind except the prerequisite
stale task.

### Quota-safe schedule

Both submit URL shapes advertise 5 creates per minute in one fixed 60 s window
([luau-submit-rate-limits](../luau-submit-rate-limits/README.md)). Ten submits
inside one window therefore need both shapes:

| Submit  | Shape  | Window | Purpose                                     |
| ------- | ------ | ------ | ------------------------------------------- |
| 1       | head   | 1      | Resolves the version from the response path |
| 2 to 6  | pinned | 1      | Pinned quota, 5 of 5                        |
| 7 to 10 | head   | 1      | Head quota, 4 of the remaining 4            |
| 11      | pinned | 2      | After `x-ratelimit-reset` elapses           |

Submits are spaced 2 s apart. The harness first reads `x-ratelimit-reset` and
waits for a fresh window when fewer than 30 s remain, so the ten first-window
submits cannot straddle a boundary.

Every head response path carries the version the head resolved to. The harness
requires each one to equal the version pinned by submit 1; any mismatch (a
publish landed mid-run) marks the run inconclusive. All fillers are therefore
proven to target one concrete version.

### Classifying a rejection

| Signal                  | Quota 429 (edge proxy) | Capacity 429 (service) |
| ----------------------- | ---------------------- | ---------------------- |
| `x-envoy-ratelimited`   | present                | absent                 |
| `x-ratelimit-remaining` | `0`                    | still non-zero         |
| body `code`             | `0` / empty            | `"RESOURCE_EXHAUSTED"` |

The quota signature is from the rate-limits spike; the capacity signature is the
third-party observation in
[#541](https://github.com/christopher-buss/bedrock/issues/541). A quota 429 at
any point is a schedule failure and makes the run inconclusive. The harness
stops at the first rejection of either kind.

A concurrent-submit cap also answers with `RESOURCE_EXHAUSTED`. Serial 2 s
spacing keeps it out of the picture, and the full body is preserved so the
message can be checked if the count does not fit either reading.

### Stale-task bracket

In stale mode the harness reads the stale task before and after the schedule and
records `state`, `createTime`, `updateTime` and age. If the task is not
`PROCESSING` before, or is terminal after, the run is invalid: the prerequisite
was not met or vanished mid-run.

### Evidence

Stdout redacts task ids. Every request's status, rate-limit headers, full body
and full task path, plus every cleanup snapshot and the verdict, go to a JSON
file named on the last line of output (default: a timestamped file in the OS
temp dir; override with `PROBE_EVIDENCE_PATH`). That file holds private
identifiers and stays out of the repo and out of any public report.

## Interpretation

The harness prints one of these verdicts; the interpretation is fixed in advance
so the outcome cannot be argued into a preferred reading.

| Control                           | Stale trial                      | Verdict                           | Meaning                                                                                                                                    |
| --------------------------------- | -------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 10 accepted, 11 capacity-rejected | 9 accepted, 10 capacity-rejected | `STALE CONSUMES CAPACITY`         | Stale state holds a slot. Draft a Roblox capacity report linked to the task-state report.                                                  |
| 10 accepted, 11 capacity-rejected | 10 accepted                      | `STALE DOES NOT CONSUME CAPACITY` | No capacity bug. Close the hypothesis. If the stale task still reads `PROCESSING`, note a lease or cleanup path the state does not expose. |
| any                               | stale task terminal after        | `INVALID`                         | Prerequisite vanished. Keep the transition as cleanup evidence; wait for another naturally stuck task.                                     |
| any                               | quota 429 or version mismatch    | `INCONCLUSIVE`                    | Schedule failure. Let every filler finish, then rerun.                                                                                     |
| not 10 / 11                       | any                              | `CONTROL BOUNDARY DIFFERS`        | External traffic or a different capacity scope. Isolate the place and account before drawing a conclusion.                                 |

## Findings

None yet. Blocked on a naturally stuck task; see Status.

## Related

- [#626](https://github.com/christopher-buss/bedrock/issues/626), the issue this
  spike answers.
- [#615](https://github.com/christopher-buss/bedrock/issues/615), capacity-aware
  admission in Ocale, which will consume the same 429 signature.
- [luau-submit-rate-limits](../luau-submit-rate-limits/README.md), the spike
  that established the quota headers and window shape this schedule relies on.

[probe]: ../../../packages/open-cloud/scripts/probe-luau-execution-capacity.ts
