---
"@bedrock-rbx/core": minor
---

Make two-phase deploy self-healing and convergent. A rebuild hook that throws now leaves the minted asset outputs and the pending-rebuild marker persisted and returns a `rebuildHookThrew` error instead of crashing `deploy()`. The next deploy re-activates two-phase from that marker (the assets are already created, so they `noop`) and republishes the marked place — forcing the publish even when the place's own diff is a `noop`. A marker present with no rebuild hook available is now a hard error (`pendingRebuildWithoutHook`) rather than a green-but-stale success; pass the new `clearPendingRebuild` option to `deploy()` to clear a stuck marker and deploy normally when deliberately abandoning two-phase. On a partial asset failure the deploy now also emits codegen for the resolved keys only.
