---
"@bedrock-rbx/core": minor
---

`bedrock import` without `--yes` now shows the live items of the Environment in a tree grouped by Kind. Select untracked items to import them, clear tracked items to write `retired: "untrack"`, edit the suggested Keys, then confirm. Nothing is written before you confirm. `planImport` takes the items to stop tracking as `untrack`.
