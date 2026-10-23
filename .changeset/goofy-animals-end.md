---
"@bedrock-rbx/ocale": patch
---

Pace each OAuth credential on its own rate-limit queue and budget, keyed by its `identity`. A token rotation keeps the queue, and an OAuth identity never shares a queue with an equal API key.
