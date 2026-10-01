---
"@bedrock-rbx/ocale": patch
---

Rate-limited bursts now finish instead of failing: requests queued behind a rate-limit reset are released at the server's reported window capacity, and a 429 that names its wait is waited out without spending `maxRetries`. A named wait over 60 seconds fails at once with the new `RateLimitWaitRefusedError`, which carries the requested wait and the 429's evidence.
