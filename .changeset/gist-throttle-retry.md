---
"@bedrock-rbx/core": patch
---

Retry a **State** write to a gist that GitHub throttled, when GitHub says how long to wait. A 403 carrying `Retry-After` is a condition that clears on a clock the caller can sit out, but the gist **Backend** treated it the same as a refused credential and gave up on the first answer, failing the whole **Deploy** over a write a second attempt would have landed. That wait is now sat out in full, once per attempt, up to thirty seconds. A throttle naming longer than that, one naming a wait of zero or less, one naming an absolute date instead of a count of seconds, and a 403 reporting the hourly budget spent are all reported rather than retried: none of them clears inside a run, and re-sending only spends more of the budget the next run needs. A 403 carrying no rate-limit headers is still a refused credential and still fails on the first answer. The statuses that were already retried keep their jittered backoff.

The reason a throttle is reported with now carries GitHub's own message. The primary hourly budget and the secondary content-creation throttle answer with the same status and the same headers, so `rate limited (403)` alone left no way to tell which limit was reached, or what to change to stop reaching it; only the body says which.
