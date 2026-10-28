---
"@bedrock-rbx/core": patch
---

Typed Luau configs accept plain string literals in the top-level `universe` and `state` of `defineConfig` and `defineEnvironment`, such as `visibility = "private"` and `backend = "gist"`, without a `:: "private"` cast. Literals inside collections, such as `passes` entries and `environments` overlays, still need `bedrock.none` or a `::` cast.
