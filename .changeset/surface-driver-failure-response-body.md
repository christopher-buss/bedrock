---
"@bedrock-rbx/core": patch
---

Surface the API response body on deploy failure lines. A driver failure whose
error carried a response body (for example a bare `HTTP 400` from a place
publish) now appends that body (bounded to 500 characters) to both the live
per-resource progress line and the terminal failure summary, so the cause is
diagnosable from CI logs alone. The live progress line also now routes
permission failures through the same grant-scope guidance as the terminal
summary, and unexpected throws print their `cause` chain instead of a static
`unexpected error` marker.
