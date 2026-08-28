---
"@bedrock-rbx/ocale": patch
---

Pace each operation against its own live rate-limit window. The header-primed budget gate read `x-ratelimit-remaining`/`-reset` off every response into a single window per API key, but Roblox meters each operation in its own per-key bucket, and those buckets have different ceilings: on one key at one instant, the Luau Execution head submit reports 38 of 40 left while the version-pinned submit reports 1 of 5. Folding both into one window made the gate thrash between unrelated buckets. A roomy reading from a `get` erased a near-exhausted `submit` window, so submits went out unpaced into a bucket with nothing left; an exhausted `submit` reading held polling `get`s until the submit window reset, minutes of waiting against a bucket with hundreds of calls to spare. Each operation now holds its own window per key, so a reading from one no longer moves another. The static per-operation token bucket, the cold-start and header-absent fallback, is unchanged.
