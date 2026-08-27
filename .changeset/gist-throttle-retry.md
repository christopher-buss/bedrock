---
"@bedrock-rbx/core": patch
---

Retry a **State** write to a gist that GitHub throttled. A 403 carrying `Retry-After`, or reporting the rate-limit budget spent, is a condition that clears on its own, but the gist **Backend** treated it the same as a refused credential and gave up on the first answer, failing the whole **Deploy** over a write a second attempt would have landed. A throttle that names its own wait is now waited out on GitHub's terms, bounded so a wait longer than the caller has cannot be sat out; everything else keeps the jittered backoff the retryable statuses already used. A 403 carrying no rate-limit headers is still a refused credential and still fails on the first answer.

The reason a throttle is reported with now carries GitHub's own message. The primary hourly budget and the secondary content-creation throttle answer with the same status and the same headers, so `rate limited (403)` alone left no way to tell which limit was reached, or what to change to stop reaching it; only the body says which.
