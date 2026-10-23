---
"@bedrock-rbx/core": minor
---

Reject `isRegionalPricingEnabled` and `storePageEnabled` on developer products. Roblox retired both fields on 2026-07-20: managed pricing replaces regional pricing, and Shop listing replaces the external store page. A config that still declares either field now fails validation with a message that names the replacement. Delete the field from your config. Bedrock no longer sends either field to Roblox, and no longer sends a follow-up update after it creates a product.
