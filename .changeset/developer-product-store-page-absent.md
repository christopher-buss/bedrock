---
"@bedrock-rbx/ocale": minor
---

Parse a developer product the create endpoint answered with. `POST /developer-products/v2/universes/{universeId}/developer-products` returns a body without `storePageEnabled`, which the read endpoint reports it on and the vendored schema marks required, so every create was rejected as a malformed response and the product it had just made was unreachable. The field is now read as absent rather than invalid, and `DeveloperProduct.storePageEnabled` is `boolean | undefined` to say so. A present value that is not a boolean is still malformed.

Callers assigning `storePageEnabled` straight to a `boolean` need to handle the absent case; reading it as a condition is unchanged.
