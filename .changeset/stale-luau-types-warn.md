---
"@bedrock-rbx/core": patch
---

Every `bedrock` command except `setup` now prints a stderr warning when `.bedrock/config.luau` differs from the Luau types the running bedrock version ships, naming `bedrock setup` as the fix. The command still runs. Set `BEDROCK_SKIP_TYPES_CHECK=1` to skip the check.
