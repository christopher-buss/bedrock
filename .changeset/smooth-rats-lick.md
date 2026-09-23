---
"@bedrock-rbx/ocale": patch
---

Read error codes and messages from Cloud v2 `code` bodies and server-management error bodies, so `ApiError.code` is set for v2 errors and sentence-valued `error` fields and validation ProblemDetails land on the message.
