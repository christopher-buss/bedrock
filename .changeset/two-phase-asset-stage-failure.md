---
"@bedrock-rbx/core": patch
---

Abort the two-phase rebuild when the asset stage fails. A deploy whose asset stage could not apply or persist now surfaces that failure (`applyFailed` / `stateWriteFailed`) instead of invoking the rebuild hook and republishing over half-applied state, so an asset-stage error is no longer masked behind a later republish result.
