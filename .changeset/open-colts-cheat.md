---
"@bedrock-rbx/ocale": patch
---

retry an idempotent request whose 2xx body arrived truncated, name the failing request on the parse error, and export the `GATEWAY_REJECTED` and `RESPONSE_UNPARSEABLE` transport codes
