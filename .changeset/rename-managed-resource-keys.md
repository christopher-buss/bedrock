---
"@bedrock-rbx/core": patch
---

Preserve Roblox resource IDs when renaming game pass, developer product, or place keys with `movedFrom` on the root config entry, and recognize place renames by their existing place ID. Persist renamed state and bookkeeping even when no live update is needed; reject conflicting or cross-kind renames before reconciliation.
