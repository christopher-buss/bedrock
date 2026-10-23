---
"@bedrock-rbx/ocale": patch
---

Return `UnexpectedResponseError` when a 2xx response body does not match the wire model. It extends `ApiError` and carries the raw body in `details`, so a consumer can tell a likely ocale bug apart from an API rejection.
