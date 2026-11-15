---
"@bedrock-rbx/core": patch
---

A developer product whose name Roblox's text filter changes (for example to `####`) now fails the deploy with a new `moderatedName` apply error that shows the submitted and stored names. State keeps the product ID and the stored name, and other resources in the deploy apply as usual. Before, the deploy succeeded and recorded the submitted name. The developer-product driver now records the name Roblox stored, and reads a renamed product back after an update.
