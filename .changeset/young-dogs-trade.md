---
"@bedrock-rbx/core": patch
---

When a config sets `universe.displayName` and a `displayName` on the universe's start place, the universe value now goes live. The deploy does not write the start place's `displayName` and emits a `startPlaceFieldSkipped` warning naming the place key. Other places keep their own `displayName`, and a former start place gets its own `displayName` back on the next deploy.
