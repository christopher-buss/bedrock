---
"@bedrock-rbx/ocale": minor
---

Adapt rate-limit pacing to the live remaining budget. The client now reads `x-ratelimit-remaining` / `x-ratelimit-reset` off every response and, per API key, spaces requests across the live window (holding until reset once the budget is spent) instead of relying only on the static, schema-derived per-operation limits and reactive 429 handling. A sibling operation on the same key can pre-empt a 429 the static bucket cannot foresee; the static token bucket remains the cold-start and header-absent fallback. `RateLimitError` gains a `remaining` field carrying the exhausted-budget signal from a 429, and multi-window `x-ratelimit-reset` values are parsed correctly.
