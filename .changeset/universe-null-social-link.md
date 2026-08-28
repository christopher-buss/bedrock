---
"@bedrock-rbx/ocale": patch
---

Parse a universe whose social link comes back as JSON `null`. The wire validator accepted `null` for every optional social link, and the mapper then read `.title` off it and threw `TypeError: Cannot read properties of null`, so one null link failed the whole `universes.get` or `universes.update` response. A null link now parses to `undefined`, the same normalization `privateServerPriceRobux` already applies.
