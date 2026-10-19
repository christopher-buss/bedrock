---
"@bedrock-rbx/ocale": patch
---

Classify each `RateLimitError` by `source` (`edge`, `service`, or `unknown`), and stop retrying Luau task creates that the Luau Execution service itself refused.
