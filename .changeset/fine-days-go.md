---
"@bedrock-rbx/ocale": patch
---

Honor Retry-After on 429 responses and wait for x-ratelimit-reset only when the reported request quota is exhausted, so capacity refusals retry promptly.
