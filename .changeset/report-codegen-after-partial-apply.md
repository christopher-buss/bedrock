---
"@bedrock-rbx/core": patch
---

An `applyFailed` error now carries `codegenFailure` when Codegen fails after a partial Apply, and the CLI reports that failure through a new `codegenFailed` progress event.
