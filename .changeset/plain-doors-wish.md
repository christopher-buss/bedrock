---
"@bedrock-rbx/ocale": patch
---

Fail requests locally with `RateLimitWaitRefusedError` while an operation is locked out by a 429 asking for more than 60 seconds, until the server's reset instant, instead of sending each one. A Luau submit refused for place capacity is not locked out. A 429 asking for 60 seconds or less now holds later requests on its operation until the wait ends, whatever `x-ratelimit-remaining` reports.
