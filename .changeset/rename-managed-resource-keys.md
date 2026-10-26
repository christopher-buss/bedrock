---
"@bedrock-rbx/core": patch
---

Preserve Roblox resource IDs when renaming config keys with `movedFrom`, and recognize place renames by their existing place ID. Persist renamed state and bookkeeping even when no live update is needed; reject conflicting or cross-kind renames before reconciliation.
