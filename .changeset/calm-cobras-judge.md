---
"@bedrock-rbx/ocale": patch
---

Add image uploads, asset reads and icon updates to `AssetsClient`. `createImage` uploads an `OpenUse` image and waits for its operation to finish, `get` reads an asset's moderation state, and `getIcon` and `updateIcon` read, set or remove the icon of a place. A failed operation returns `AssetOperationError`. Each call accepts an API key or an OAuth token.
