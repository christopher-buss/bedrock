---
"@bedrock-rbx/ocale": patch
---

Accept the `STATE_UNSPECIFIED` task state and `ERROR_CODE_UNSPECIFIED` error code on Luau Execution tasks. Roblox's OpenAPI schema declares both, and the parser previously rejected them as malformed responses. Both values are now passed through verbatim; pollers keep polling on `STATE_UNSPECIFIED`.
