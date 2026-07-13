---
"@bedrock-rbx/ocale": patch
---

Carry the offending response body on `ApiError.details` everywhere it was
previously dropped: the 401/403 → `PermissionError` upgrade now forwards
`details`, every `Malformed … response` parser error attaches the body that
failed validation, and the publish-response JSON decode failure attaches both
the raw string body and the underlying `SyntaxError` as `cause`.
