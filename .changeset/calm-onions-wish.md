---
"@bedrock-rbx/ocale": patch
---

Add `BadgesClient.getFreeQuota` to read a universe's free badge quota without a credential, return `BadgeCostMismatchError` when Roblox refuses a badge create's expected cost, and return the uploaded icon's `iconImageId` from `BadgesClient.uploadIcon`.
