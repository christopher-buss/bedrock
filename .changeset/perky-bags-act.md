---
"@bedrock-rbx/ocale": minor
---

Listing experience icons no longer fails for a universe still on the default icon. Roblox sends a null image id for that icon, so `ExperienceIcon.imageId` is now `string | undefined`.
