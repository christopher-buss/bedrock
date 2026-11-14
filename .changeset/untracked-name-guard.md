---
"@bedrock-rbx/core": minor
---

**Breaking:** `deploy` and `diff` now stop before any write when a planned game pass, developer product or badge create has the name of a live item that no Key tracks. Before, the deploy created a duplicate. The run prints the `importId` line that takes the item over: add it to the Environment's overlay entry and run again. With `live: false` (`--no-live`) there is no live list, so the guard does not run.
