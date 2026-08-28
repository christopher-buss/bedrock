---
"@bedrock-rbx/ocale": patch
---

Keep the request context when a 401 or 403 is upgraded to a `PermissionError`. The upgrade rebuilt the transport's `ApiError` and carried only `cause`, `code`, `details`, and `statusCode`, so `elapsedMs`, `gatewaySummary`, `method`, `responseHeaders`, and `url` came back undefined on exactly the two statuses where naming the failing call and the credential is the whole question. Every other status already reported them.

A 401 or 403 served by an edge gateway is no longer upgraded at all. It arrives with a `gatewaySummary` and never reached the operation whose scopes the upgrade would name, so reporting it as a scope failure sent the caller to their API key settings over a request Open Cloud never saw. It stays an `ApiError`, as the other statuses a gateway answers with already did.

New `requestContextOf(err)` reads those transport-captured fields off an `ApiError` for spreading into the options of a replacement error, so a consumer that rewraps a failure with its own message keeps the context instead of enumerating the fields by hand.
