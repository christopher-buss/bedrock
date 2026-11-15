---
"@bedrock-rbx/core": patch
"@bedrock-rbx/ocale": patch
---

Badge and game pass entries may omit `icon`. A create with no icon sends no image, and Roblox gives the item its default icon. `CreateBadgeParameters.icon` is now optional.
