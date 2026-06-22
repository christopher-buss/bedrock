---
"@bedrock-rbx/core": minor
---

Add the happy-path two-phase deploy. Supply a `rebuild` hook to `deploy()` and, when the diff contains a provisioned `create` (a game pass or developer product), bedrock mints the assets first, persists them with a pending-rebuild marker, runs codegen, invokes the hook with the post-asset-stage state, then republishes each returned place from the hook's rebuilt bytes — embedding freshly minted IDs in a single deploy instead of a second one. Multi-place universes republish per keyed entry, and the marker is cleared once the places are republished. With no hook supplied, places publish in a single pass exactly as before. Surfaces the `RebuildHook`, `RebuiltPlace`, and `ResourceApplyContext` types from the public API; `ResourceDriver.create`/`update` now accept an optional apply-context argument.
