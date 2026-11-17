---
"@bedrock-rbx/core": patch
---

`buildDefaultRegistry` accepts an optional `httpClient` that sends every Open Cloud request its clients make. Icon downloads from the CDN still use the global `fetch`.
