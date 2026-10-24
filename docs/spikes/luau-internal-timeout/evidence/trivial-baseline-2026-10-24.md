# Luau Execution internal-timeout probe: trivial-baseline

- Started 2026-10-24T00:40:27.332Z, finished 2026-10-24T00:43:17.525Z
- Target: universe <universe>, place <place>, version <version>
- Script: `return "ok"`
- Caps: 20 accepted tasks, 40 submits, 330000 ms observation per task

## Result

No reproduction in 20 accepted tasks (0/20 exact matches). 95% one-sided upper
bound on the true rate: 13.9%. This bounds the sample; it does not show the
incident cannot recur.

| Classification       | Count |
| -------------------- | ----- |
| cancelled            | 0     |
| complete             | 20    |
| deadline-exceeded    | 0     |
| failed-other         | 0     |
| internal-error-other | 0     |
| internal-timeout     | 0     |
| observation-bound    | 0     |
| poll-failed          | 0     |

Rejected submits, outside the denominator: 0 rate-limited, 0 request-path.
