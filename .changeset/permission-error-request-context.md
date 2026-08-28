---
"@bedrock-rbx/ocale": patch
---

Keep the request context when a 401 or 403 is upgraded to a `PermissionError`. The upgrade rebuilt the transport's `ApiError` and carried only `cause`, `code`, `details`, and `statusCode`, so `elapsedMs`, `gatewaySummary`, `method`, `responseHeaders`, and `url` came back undefined on exactly the two statuses where naming the failing call and the credential is the whole question. Every other status already reported them.

New `requestContextOf(err)` reads those transport-captured fields off an `ApiError` for spreading into the options of a replacement error, so a consumer that rewraps a failure with its own message keeps the context instead of enumerating the fields by hand.
