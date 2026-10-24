---
"@bedrock-rbx/core": patch
---

`bedrock setup` takes `--alias <name>` and `--types-path <path>` and remembers them for later runs, moving its own alias when the types path changes. `--types-path` must be a relative path to a file named `config.luau`, and a leading `@` on `--alias` is dropped. When `.luaurc` already uses the alias for something else, setup tells you to pass `--alias`.
