---
"@bedrock-rbx/core": patch
---

Gist state read/write failures now carry GitHub's error response body
(bounded to 500 characters) in the failure reason instead of only the status
code, and state-path network errors name the transport code (for example
`ECONNRESET`) from the fetch error's cause chain.
