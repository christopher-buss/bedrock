---
"@bedrock-rbx/core": none
---

Test-only change: the migrate command's spec now injects the project loader instead of falling through to real config discovery, so it no longer depends on the working directory the test runner was started from. No shipped behaviour changes.
