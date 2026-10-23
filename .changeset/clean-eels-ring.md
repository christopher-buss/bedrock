---
"@bedrock-rbx/ocale": patch
"@bedrock-rbx/core": patch
---

An `UnexpectedResponseError` from an ocale client now ends its message with a line that links to a prefilled ocale bug report. The link is also on the new `reportUrl` property. It holds the message, status, failing call and response headers, but not the body. Set `reportHint: false` on the client options to leave the line out, for example when your tool renders its own failure output. The bedrock CLI ends an unexpected-response failure with the same link.
