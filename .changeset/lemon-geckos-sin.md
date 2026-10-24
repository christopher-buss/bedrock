---
"@bedrock-rbx/ocale": minor
---

Creating a badge no longer fails on the response Roblox actually sends. The awarder comes back without a name and with its type as the string `"Place"`, so `BadgeAwarder.name` is now `string | undefined`.
