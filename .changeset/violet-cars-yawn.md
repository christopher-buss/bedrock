---
"@bedrock-rbx/ocale": minor
---

Stop sending `isRegionalPricingEnabled` and `storePageEnabled`, which Roblox retired on 2026-07-20. `isRegionalPricingEnabled` is removed from the create and update parameters of developer products and game passes; managed pricing replaces regional pricing. `storePageEnabled` is removed from `UpdateDeveloperProductParameters` and from the parsed `DeveloperProduct`; Shop listing replaces the external store page. Remove these fields from your calls.
