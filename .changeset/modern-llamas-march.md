---
"@bedrock-rbx/core": patch
---

Add a `--verbose` flag (or `BEDROCK_VERBOSE=1`) that follows each failure with its earlier retry attempts, stacks, and cause chain. Failure lines for retried requests now say how many earlier attempts failed.
