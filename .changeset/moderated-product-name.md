---
"@bedrock-rbx/core": minor
---

**Breaking:** A deploy whose developer-product name Roblox's text filter changes (for example to `####`) now fails with a `moderatedName` apply error that shows the submitted and stored names. Before, it succeeded and recorded the submitted name. Choose a name the filter accepts. State keeps the product ID and the stored name, and other resources in the deploy still apply.
