---
"@bedrock-rbx/ocale": patch
---

Return `UnexpectedResponseError` when a resource parser rejects the shape of a response body. Restart parsers still return a plain `ApiError`. It extends `ApiError` and carries the raw body in `details`, so a consumer can tell a likely ocale bug apart from an API rejection.
