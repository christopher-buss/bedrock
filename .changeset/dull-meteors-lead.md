---
"@bedrock-rbx/ocale": minor
"@bedrock-rbx/core": patch
---

**Breaking:** a response body that a resource parser rejects now returns `UnexpectedResponseError` instead of `ApiError`. The new class extends `OpenCloudError`, not `ApiError`, so `instanceof ApiError` no longer matches a malformed response; branch on `UnexpectedResponseError` instead. It carries the raw body in `details`, the `statusCode`, and the request `method`, `url`, and allowlisted `responseHeaders`, so a consumer can tell a likely ocale bug apart from an API rejection. Restart parsers still return a plain `ApiError`.

The bedrock CLI shows the body, the failing call, and the response headers for an `UnexpectedResponseError`, as it does for an `ApiError`.
