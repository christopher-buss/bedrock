---
"@bedrock-rbx/ocale": minor
---

Read the Open Cloud v2 `error` field when building an `ApiError`, so canonical
statuses such as `NOT_FOUND`, `INVALID_ARGUMENT` and `PERMISSION_DENIED` reach
`ApiError.code` instead of being reachable only through `ApiError.details`. The
message of a v2 error now carries the usual `(code NOT_FOUND)` suffix.

`code` also moves onto the `OpenCloudError` base, so a caller holding the error
that `Result.err` is typed as can branch on it without first narrowing to a
subclass. `ValidationError.code` keeps its narrower closed union.

Breaking, at the type level only: `OpenCloudError` used to be structurally
identical to `Error`, so any `Error` satisfied it. It now carries `code`, and a
bare `Error` no longer does. Pass a real SDK error, or widen the parameter to
`Error`.
