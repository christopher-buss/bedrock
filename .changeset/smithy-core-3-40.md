---
"@bedrock-rbx/state-s3": patch
---

Update dependencies:
- @smithy/core: 3.37.0 → 3.40.0

S3 retry timing changes: the base backoff is now 50 ms for transient
server errors (was 100 ms) and 1 s for throttling errors such as
`SlowDown` (was 500 ms).
