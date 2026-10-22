---
"@bedrock-rbx/ocale": patch
---

Return `CredentialRejectedError` with the OAuth `identity` when Roblox refuses an OAuth token: a non-gateway 401, or a 502 whose body says "Scope authorization failed.". The call is not retried. An OAuth 403 stays `PermissionError`, and its message now says the grant may not include the scope or this universe. API-key behavior does not change.
