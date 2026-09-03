---
"@bedrock-rbx/ocale": patch
---

Read the Open Cloud v2 `error` field when building an `ApiError`, so canonical
statuses such as `NOT_FOUND`, `INVALID_ARGUMENT` and `PERMISSION_DENIED` reach
`ApiError.code` instead of being reachable only through `ApiError.details`. The
message of a v2 error now carries the usual `(code NOT_FOUND)` suffix.
