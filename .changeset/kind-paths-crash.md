---
"@bedrock-rbx/core": patch
---

`bedrock setup` takes `--alias <name>` and `--types-path <path>` and remembers them for later runs, moving its own alias when the types path changes. When `.luaurc` already uses the alias for something else, setup tells you to pass `--alias`.
