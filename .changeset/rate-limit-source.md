---
"@bedrock-rbx/ocale": patch
---

Add `RateLimitError.source`, which reports whether the edge gateway or the service behind it refused a 429, or `unknown` without positive evidence.
