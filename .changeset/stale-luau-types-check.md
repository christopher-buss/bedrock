---
"@bedrock-rbx/core": patch
---

Add `bedrock setup --check`, which writes nothing and exits non-zero when `.bedrock/config.luau` is stale or missing, for pre-commit hooks and CI gates.
