---
"@bedrock-rbx/ocale": patch
---

Accept an OAuth `credential` (`{ kind: "oauth", identity, getAccessToken }`). The client calls `getAccessToken` once per attempt, after every admission wait, and sends `Authorization: Bearer`. A failing provider returns the new `CredentialError` and spends no retry. Request headers can no longer set `authorization`.
