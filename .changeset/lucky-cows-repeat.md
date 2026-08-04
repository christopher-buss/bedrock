---
"@bedrock-rbx/core": patch
---

Stop reporting an HTTP 401 as a missing scope. Roblox answers 401 for a key that
is invalid, disabled, or expired as well as for one whose scopes fall short, so
the deploy failure now reads "the API key was rejected" and lists the scope as
one thing to check. A 403 keeps the definite "missing required scope" wording.
