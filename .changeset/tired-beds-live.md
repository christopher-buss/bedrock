---
"@bedrock-rbx/ocale": minor
---

Refresh the vendored Open Cloud OpenAPI spec and surface the new required isManagedPricingEnabled field on GamePass and DeveloperProduct responses. Response parsers now require the field, and constructing these response types (for example in test fakes) needs the new property, so this is a breaking boundary for 0.x consumers. Also repairs the spec refresh flow: schema patches expand $n capture groups again instead of inserting them literally, the sorted-map items rename patch (fixed upstream by Roblox) is removed, and an unchanged pinned commit no longer aborts the refresh.
