---
"@bedrock-rbx/core": patch
---

A redacted place that declares `icon` uploads the embedded redacted placeholder in place of the declared file. `RedactedPlaceOverride` gains `icon` in TypeScript and Luau, so `redacted: { icon: { "en-us": path } }` uploads your own placeholder instead. A redacted place without `icon` keeps its live icon unmanaged, and `icon: none` still removes it.
