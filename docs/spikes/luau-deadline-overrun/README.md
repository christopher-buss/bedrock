# Luau Execution deadline-overrun spike

Reproduction attempt for
[christopher-buss/bedrock#622](https://github.com/christopher-buss/bedrock/issues/622):
can a Luau Execution task whose script is proven to have started remain
`PROCESSING` past its requested `timeout`?

## Question

Roblox documents that a script exceeding `timeout` fails, with the terminal
resource reading `FAILED` and `error.code = DEADLINE_EXCEEDED`. A production
incident saw a task reach its first in-runtime MemoryStore write and then stay
`PROCESSING`. An earlier 12-task smoke run could not reproduce that.

This is a contract test, not a workaround. A green result means the basic
timeout contract held on this place and version for this sample. It does not
disprove an intermittent service defect.

## Method

One probe,
[`probe-luau-deadline-overrun.ts`](../../../packages/open-cloud/scripts/probe-luau-deadline-overrun.ts),
whose logic lives in the unit-tested
[`luau-deadline-overrun.ts`](../../../packages/open-cloud/scripts/luau-deadline-overrun.ts).
It uses raw `fetch` against `apis.roblox.com`: no SDK, no pacing, no retries,
one 15 second abort signal per request. The reportable path is therefore
independent of Ocale, Bedrock, Jest, and Nx.

Every task requests `timeout: "5s"` and is polled once per second for at most 60
seconds. Each task's script first writes a `<kind>-started` item to a
MemoryStore sorted map scoped to the run; the probe reads that item back over
Open Cloud, so "the script started" is proven by the script itself, not inferred
from `state`.

The ladder, in order:

| Stage       | Script                                                     | Expected terminal state      |
| ----------- | ---------------------------------------------------------- | ---------------------------- |
| `bootstrap` | `return 0`, at head, only to learn the version id          | `COMPLETE`                   |
| `control`   | write `control-started`, `control-finished`, return        | `COMPLETE`                   |
| `yielding`  | write `yielding-started`, `while true do task.wait(1) end` | `FAILED / DEADLINE_EXCEEDED` |
| `busy`      | write `busy-started`, `while true do end`                  | `FAILED / DEADLINE_EXCEEDED` |

Every stage after the bootstrap is submitted at the version-pinned endpoint. The
run stops at the first stage that does not pass: Open Cloud has no cancellation,
so the probe never stacks a task on top of a non-terminal one.

### Binary input deltas

`OCALE_PROBE_BINARY_INPUT` adds one variable to the ladder. It is `none` by
default, which is the base ladder above.

| Mode      | Change                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `unused`  | After the version is known, create one `LuauExecutionSessionTaskBinaryInput`, upload the 13 bytes `bedrock-probe`, attach it to every task. |
| `decoded` | As `unused`, and every script first reads `({...})[1].BinaryInput` and calls `error` unless `buffer.tostring` of it is `bedrock-probe`.     |

The scripts in `unused` mode are byte-for-byte the base scripts. In `decoded`
mode the check runs before the `started` marker, so a `control` that reaches
`COMPLETE` proves the task received and decoded the input. The upload goes to
the presigned `uploadUri` without the API key. The upload is a stage of its own
(`binary-input`); if the create or the upload fails, the run stops before it
submits a task.

A stage is **red** only when its `started` marker exists and the native resource
is still non-terminal at the 60 second bound. The documented
`FAILED / DEADLINE_EXCEEDED` is a **pass**. A `finished` marker beside a
non-terminal state is classified separately as lost terminal publication. A task
that never terminalises without a marker is `START_UNPROVEN`, not red.

### Controls

- Refuses to run unless `OCALE_PROBE_DISPOSABLE_PLACE` equals the target place
  id; this is the operator's statement that the place is disposable and has no
  other submitters.
- Never logs or records the API key. Every record is written to a gitignored
  private artifact first; the shareable copy under [`evidence/`](./evidence/)
  has session, task, and binary input ids replaced by stable pseudonyms, the key
  owner's `user` id scrubbed, and the presigned upload URI cut to its origin.
  Universe, place, and version ids are public and kept.
- Every task submitted is counted, including the bootstrap.

### Exact command

Bun loads `.env` from the working directory, which supplied `ROBLOX_API_KEY` and
`ROBLOX_TEST_UNIVERSE_ID`. Run 1 resolved the version by submitting at head;
runs 2 and 3 pinned it explicitly and skipped the bootstrap.

```bash
OCALE_PROBE_DISPOSABLE_PLACE=15098004467 ROBLOX_TEST_PLACE_ID=15098004467 bun packages/open-cloud/scripts/probe-luau-deadline-overrun.ts
```

```bash
OCALE_PROBE_DISPOSABLE_PLACE=15098004467 ROBLOX_TEST_PLACE_ID=15098004467 ROBLOX_TEST_PLACE_VERSION_ID=6 bun packages/open-cloud/scripts/probe-luau-deadline-overrun.ts
```

The binary input deltas were 3 runs per mode, pinned to version 6, each run
started 70 s after the previous one ended:

```bash
OCALE_PROBE_BINARY_INPUT=unused OCALE_PROBE_DISPOSABLE_PLACE=15098004467 ROBLOX_TEST_PLACE_ID=15098004467 ROBLOX_TEST_PLACE_VERSION_ID=6 bun packages/open-cloud/scripts/probe-luau-deadline-overrun.ts
```

```bash
OCALE_PROBE_BINARY_INPUT=decoded OCALE_PROBE_DISPOSABLE_PLACE=15098004467 ROBLOX_TEST_PLACE_ID=15098004467 ROBLOX_TEST_PLACE_VERSION_ID=6 bun packages/open-cloud/scripts/probe-luau-deadline-overrun.ts
```

## Findings

### Base ladder

Ran on 2026-09-19 (UTC) against universe `5202621917`, place `15098004467`,
version `6`, from one API key and one IP with no other submitters. Three
attempts, ten tasks, every one terminal. **The run did not reproduce.**

| Run                                                       | Stage       | State sequence         | Create to terminal | Started marker | Verdict                  |
| --------------------------------------------------------- | ----------- | ---------------------- | ------------------ | -------------- | ------------------------ |
| [`mu90nt6i-2bbf65a8`](./evidence/mu90nt6i-2bbf65a8.jsonl) | `bootstrap` | `PROCESSING, COMPLETE` | 1.77 s             | n/a            | `PASS_COMPLETE`          |
|                                                           | `control`   | `PROCESSING, COMPLETE` | 2.73 s             | 23:26:30Z      | `PASS_COMPLETE`          |
|                                                           | `yielding`  | `PROCESSING, FAILED`   | 6.03 s             | 23:26:33Z      | `PASS_DEADLINE_EXCEEDED` |
|                                                           | `busy`      | `PROCESSING, FAILED`   | 11.07 s            | 23:26:40Z      | `PASS_DEADLINE_EXCEEDED` |
| [`mu90peig-fcbed2f7`](./evidence/mu90peig-fcbed2f7.jsonl) | `control`   | `PROCESSING, COMPLETE` | 1.50 s             | 23:27:42Z      | `PASS_COMPLETE`          |
|                                                           | `yielding`  | `PROCESSING, FAILED`   | 5.97 s             | 23:27:45Z      | `PASS_DEADLINE_EXCEEDED` |
|                                                           | `busy`      | `PROCESSING, FAILED`   | 11.33 s            | 23:27:52Z      | `PASS_DEADLINE_EXCEEDED` |
| [`mu90racb-37e79cc6`](./evidence/mu90racb-37e79cc6.jsonl) | `control`   | `PROCESSING, COMPLETE` | 1.20 s             | 23:29:09Z      | `PASS_COMPLETE`          |
|                                                           | `yielding`  | `PROCESSING, FAILED`   | 7.18 s             | 23:29:13Z      | `PASS_DEADLINE_EXCEEDED` |
|                                                           | `busy`      | `PROCESSING, FAILED`   | 11.09 s            | 23:29:19Z      | `PASS_DEADLINE_EXCEEDED` |

"Create to terminal" is `updateTime - createTime` on the final task body.
"Started marker" is the value the script wrote, read back over Open Cloud.

Final body of the yielding target in run 1, redacted:

```json
{
	"path": "universes/5202621917/places/15098004467/versions/6/luau-execution-sessions/session-4e8ff678/tasks/task-4e8ff678",
	"createTime": "2026-09-19T23:26:32.959Z",
	"updateTime": "2026-09-19T23:26:38.991Z",
	"user": "<redacted>",
	"state": "FAILED",
	"timeout": "5s",
	"error": {
		"code": "DEADLINE_EXCEEDED",
		"message": "Script execution timed out. The script took longer than the configured timeout."
	},
	"enableBinaryOutput": false
}
```

### Binary input delta runs

Ran on 2026-10-24 (UTC) against the same universe, place, and version, from one
API key and one IP with no other submitters. Six runs, three per mode, 24
stages: six binary inputs created and uploaded, 18 tasks submitted, every task
terminal. **Neither delta reproduced.**

| Run                                                       | Stage          | State sequence         | Create to terminal | Started marker | Verdict                  |
| --------------------------------------------------------- | -------------- | ---------------------- | ------------------ | -------------- | ------------------------ |
| **`unused`**                                              |                |                        |                    |                |                          |
| [`mvmnl9cu-dfb663df`](./evidence/mvmnl9cu-dfb663df.jsonl) | `binary-input` | create 200, upload 200 | n/a                | n/a            | `PASS_COMPLETE`          |
|                                                           | `control`      | `PROCESSING, COMPLETE` | 1.08 s             | 17:09:01Z      | `PASS_COMPLETE`          |
|                                                           | `yielding`     | `PROCESSING, FAILED`   | 5.96 s             | 17:09:04Z      | `PASS_DEADLINE_EXCEEDED` |
|                                                           | `busy`         | `PROCESSING, FAILED`   | 11.21 s            | 17:09:10Z      | `PASS_DEADLINE_EXCEEDED` |
| [`mvmnn8d8-720d98cd`](./evidence/mvmnn8d8-720d98cd.jsonl) | `binary-input` | create 200, upload 200 | n/a                | n/a            | `PASS_COMPLETE`          |
|                                                           | `control`      | `PROCESSING, COMPLETE` | 1.26 s             | 17:10:33Z      | `PASS_COMPLETE`          |
|                                                           | `yielding`     | `PROCESSING, FAILED`   | 5.89 s             | 17:10:35Z      | `PASS_DEADLINE_EXCEEDED` |
|                                                           | `busy`         | `PROCESSING, FAILED`   | 11.12 s            | 17:10:42Z      | `PASS_DEADLINE_EXCEEDED` |
| [`mvmnp6wy-fd0859a1`](./evidence/mvmnp6wy-fd0859a1.jsonl) | `binary-input` | create 200, upload 200 | n/a                | n/a            | `PASS_COMPLETE`          |
|                                                           | `control`      | `PROCESSING, COMPLETE` | 1.11 s             | 17:12:05Z      | `PASS_COMPLETE`          |
|                                                           | `yielding`     | `PROCESSING, FAILED`   | 5.95 s             | 17:12:07Z      | `PASS_DEADLINE_EXCEEDED` |
|                                                           | `busy`         | `PROCESSING, FAILED`   | 11.01 s            | 17:12:13Z      | `PASS_DEADLINE_EXCEEDED` |
| **`decoded`**                                             |                |                        |                    |                |                          |
| [`mvmnr5h0-f6575749`](./evidence/mvmnr5h0-f6575749.jsonl) | `binary-input` | create 200, upload 200 | n/a                | n/a            | `PASS_COMPLETE`          |
|                                                           | `control`      | `PROCESSING, COMPLETE` | 1.20 s             | 17:13:36Z      | `PASS_COMPLETE`          |
|                                                           | `yielding`     | `PROCESSING, FAILED`   | 5.91 s             | 17:13:38Z      | `PASS_DEADLINE_EXCEEDED` |
|                                                           | `busy`         | `PROCESSING, FAILED`   | 11.10 s            | 17:13:45Z      | `PASS_DEADLINE_EXCEEDED` |
| [`mvmnt3z6-8731015a`](./evidence/mvmnt3z6-8731015a.jsonl) | `binary-input` | create 200, upload 200 | n/a                | n/a            | `PASS_COMPLETE`          |
|                                                           | `control`      | `PROCESSING, COMPLETE` | 1.10 s             | 17:15:08Z      | `PASS_COMPLETE`          |
|                                                           | `yielding`     | `PROCESSING, FAILED`   | 7.34 s             | 17:15:11Z      | `PASS_DEADLINE_EXCEEDED` |
|                                                           | `busy`         | `PROCESSING, FAILED`   | 11.00 s            | 17:15:18Z      | `PASS_DEADLINE_EXCEEDED` |
| [`mvmnv47o-b53ec174`](./evidence/mvmnv47o-b53ec174.jsonl) | `binary-input` | create 200, upload 200 | n/a                | n/a            | `PASS_COMPLETE`          |
|                                                           | `control`      | `PROCESSING, COMPLETE` | 1.09 s             | 17:16:41Z      | `PASS_COMPLETE`          |
|                                                           | `yielding`     | `PROCESSING, FAILED`   | 5.95 s             | 17:16:43Z      | `PASS_DEADLINE_EXCEEDED` |
|                                                           | `busy`         | `PROCESSING, FAILED`   | 11.15 s            | 17:16:50Z      | `PASS_DEADLINE_EXCEEDED` |

Every task body echoed the attached input, for example
`"binaryInput": "universes/5202621917/luau-execution-session-task-binary-inputs/binary-input-a92cf834"`
on the yielding target of the first `unused` run. Each `decoded` control reached
`COMPLETE` with both markers written, so the check before the markers passed and
the script read exactly `bedrock-probe`. The timings match the base ladder:
about 6 s for a yielding target and about 11 s for a busy one.

### Observations beside the main result

- **The create response already reads `PROCESSING`.** No task was ever observed
  in `QUEUED`. The first poll, about 130 ms after the create, also read
  `PROCESSING`.
- **The busy loop overshoots the deadline.** A yielding script fails about 1 s
  after its 5 s budget; a non-yielding `while true do end` takes about 11 s from
  creation, roughly 10 s after its marker. Enforcement on a thread that never
  yields is evidently coarser, but it still terminates.
- **Every response carried live quota headers.** Version-pinned submits read
  `x-ratelimit-limit: 5, 5;w=60, 5;w=60`, `remaining` stepping 4, 3, 2 across
  the three experiment tasks. The head submit in run 1 also read a limit of 5,
  matching [#627](https://github.com/christopher-buss/bedrock/pull/627).
- **Each task read costs 4 units of a 200 window.** Task reads carried
  `x-ratelimit-limit: 200, 200;w=60, 200;w=60`, and `remaining` fell 127, 123,
  119, 117, 112, 108 across consecutive single GETs in run 1. A 200 window spent
  4 at a time allows about 50 reads per minute, close to the 45 the
  human-readable docs state. Out of scope here; relevant to how Ocale paces
  `Cloud_GetLuauExecutionSessionTask`.
- **Sorted-map item reads report a 1000 per minute limit.** Marker reads carried
  `x-ratelimit-limit: 1000, 1000;w=60, 1000000;w=60`. The vendored schema
  encodes 1,000,000 for `Cloud_GetMemoryStoreSortedMapItem`; the binding first
  token is 1000. Out of scope here, noted for the schema-drift ledger.
- **Binary input create is 5 per minute.** Every create read
  `x-ratelimit-limit: 5, 45;w=60, 5;w=60` with `remaining: 4`. This matches the
  vendored schema for `Cloud_CreateLuauExecutionSessionTaskBinaryInput`.
- **The upload target is a presigned S3 URL.** The `uploadUri` host is an AWS S3
  bucket. A plain `PUT` of the bytes, with no API key and no content type,
  returned 200.
- Every response carried `roblox-machine-id`, `x-envoy-attempt-count: 1`, and
  `x-roblox-edge`, so Roblox can correlate any task from the private artifact.

### Scripts as submitted

The map name embeds the run id, so each run's digest differs. Sources are in
each evidence file's `submit` record (`detail.requestBody`). Run 1 digests:

| Stage       | SHA-256                                                            |
| ----------- | ------------------------------------------------------------------ |
| `bootstrap` | `30945f342ad5ab6c0823be6d0a24400b85ecf17eecbe678f5780b426b1815170` |
| `control`   | `adf87618885d060423850b8ff15511fae80ff03c80697bc2e9e0975e2b7beea5` |
| `yielding`  | `45d8620b404bc199af9373916ac40198e7781dbac7d93ca067a60f3de745022c` |
| `busy`      | `af1c7e788258fd6fd9661df646ee449693e36abd4de60be07002455353836033` |

Yielding target, run 1:

```lua
local MemoryStoreService = game:GetService("MemoryStoreService")
local map = MemoryStoreService:GetSortedMap("bedrock-probe-mu90nt6i-2bbf65a8")
map:SetAsync("yielding-started", DateTime.now():ToIsoDate(), 3600)
while true do
	task.wait(1)
end
```

In `unused` mode the sources are the base sources. First `decoded` run
(`mvmnr5h0-f6575749`) digests:

| Stage      | SHA-256                                                            |
| ---------- | ------------------------------------------------------------------ |
| `control`  | `d05dbefe36436e91baea51ed2d8a86ecd157021fe7c5160374200cc1300767cb` |
| `yielding` | `1678856d502f075f507dcd2c4d7bc845b892c47b9ea111400db91b92c101e902` |
| `busy`     | `0776285bf3dd6d8524fd99d7383987dd8de981886e92d0f07b131241580451c0` |

Yielding target, first `decoded` run:

```lua
local input = ({...})[1]
if buffer.tostring(input.BinaryInput) ~= "bedrock-probe" then
	error("unexpected binary input")
end
local MemoryStoreService = game:GetService("MemoryStoreService")
local map = MemoryStoreService:GetSortedMap("bedrock-probe-mvmnr5h0-f6575749")
map:SetAsync("yielding-started", DateTime.now():ToIsoDate(), 3600)
while true do
	task.wait(1)
end
```

## Interpretation

On this place and version, with one submitter, the basic timeout contract holds
for both a yielding and a non-yielding script that provably started: ten of ten
tasks reached a terminal state, and the eight targets reached exactly the
documented `FAILED / DEADLINE_EXCEEDED`. An attached binary input, read or not,
does not change that: 18 of 18 more tasks terminal, the 12 targets all
`FAILED / DEADLINE_EXCEEDED`. Nine attempts is a finite green sample. It narrows
the trigger; it does not establish that the intermittent production incident is
fixed.

### Boundaries ruled out

- Yielding script, 5 s timeout, version-pinned, single submitter: 3 of 3
  terminal.
- Non-yielding script, 5 s timeout, version-pinned, single submitter: 3 of 3
  terminal.
- Delta 1, attached-but-unused binary input, same targets: 3 of 3 runs, 6 of 6
  targets terminal.
- Delta 2, tiny binary input decoded before the marker, same targets: 3 of 3
  runs, 6 of 6 targets terminal.
- Marker service: the MemoryStore write from inside the runtime and the Open
  Cloud read-back worked on every task that carried a marker.

### Boundaries not yet tested

The remaining deltas, one at a time, in the order the issue sets:

3. bundle reconstruction;
4. one Jest test;
5. production result relay;
6. concurrency.

The first red delta defines the next minimal case. Deltas 3 to 5 reproduce parts
of the production workload, so each needs a self-contained definition before it
can join the ladder. Concurrency needs none, but the pinned submit bucket of 5
per minute caps it at 5 tasks in flight.

### Roblox report

Not filed. There is no red case to report. If a later delta goes red, the
private artifact under `packages/open-cloud/reports/luau-deadline-overrun/`
holds the full unredacted task path for that run; a report should quote it and
ask Roblox to inspect the server-side execution and session record.

## Cleanup and capacity

- Nothing to clean up: every task is terminal, the sorted-map marker items
  expire on their own after 3600 s, and each binary input expires 15 minutes
  after it is created.
- The pinned submit bucket is 5 per minute. One run uses 3 pinned submits (4
  when it bootstraps at head, which draws on a separate 5 per minute bucket), so
  runs must be spaced at least a minute apart. Runs 2 and 3 were spaced 65 s
  apart and no submit was throttled.
- A delta run also uses 1 binary input create, from its own 5 per minute bucket.
  The six delta runs were spaced 70 s apart and no request was throttled. The
  second `unused` run brought the pinned bucket to `remaining: 0` on its last
  submit, so 70 s is close to the minimum spacing.
- The private artifacts are gitignored (`reports/`) and stay on the operator's
  machine.

## Related

- [#622](https://github.com/christopher-buss/bedrock/issues/622), the issue this
  spike answers.
- [DevForum: Luau execution requests are sometimes never finishing](https://devforum.roblox.com/t/luau-execution-requests-are-sometimes-never-finishing/3776197),
  the existing public report.
- [Luau submit rate limits spike](../luau-submit-rate-limits/README.md), the
  earlier probe on the same place.
