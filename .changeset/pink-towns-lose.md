---
"@bedrock-rbx/core": patch
---

In an Environment with both `spendLimit` and `allowDeferredCreates: true`, a badge shortfall the Spend limit cannot fully cover no longer refuses the Deploy. With `allowSpend: true`, Bedrock pays for the creates beyond the free badge quota up to the limit, in Key order, and the rest become Deferred creates that the next Deploy tries again. A create Roblox refuses for cost that the limit can no longer pay for is deferred too.
