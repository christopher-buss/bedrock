---
"@bedrock-rbx/core": minor
"@bedrock-rbx/ocale": minor
---

Preserve more diagnostic detail on failures. `RateLimitError` now carries the
429 response body on `details` (parsed JSON or truncated raw text) plus the
`statusCode`, mirroring `ApiError`. Deploy, codegen, and config-load failure
messages now render the underlying `cause` chain instead of only the outermost
error message, so a wrapped build, emit, write, file-read, or config-function
throw stays diagnosable from the log alone.
