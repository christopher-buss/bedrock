---
"@bedrock-rbx/core": patch
---

In an Environment with `allowDeferredCreates: true`, a free badge quota that cannot be read no longer stops `bedrock deploy`: badge creates run one at a time in key order, and once Roblox refuses one for cost, it and every later badge become deferred creates without sending a request.
