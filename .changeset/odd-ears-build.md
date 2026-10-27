---
"@bedrock-rbx/core": patch
---

`bedrock setup` adds its alias to an existing `.config.luau` instead of creating a `.luaurc` beside it, refuses a project holding both files, and prints the entry to add when the file is not a literal table. The types check also warns when the `.config.luau` alias is missing or points elsewhere.
