---
"@bedrock-rbx/core": minor
"@bedrock-rbx/ocale": minor
"@bedrock-rbx/state-s3": minor
---

Reject unresolved orphan state before diff, provision, publish, or deploy applies any operation. This is breaking for existing projects whose state contains resources absent from config. Restore each old key with `retired: "untrack"` to stop managing it without changing the live Roblox resource, use `retired: true` to retire it, or declare `movedFrom` on a renamed entry to preserve its Roblox ID. Removing a managed universe remains unavailable.
