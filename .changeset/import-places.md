---
"@bedrock-rbx/core": minor
---

`bedrock import` now imports places. The place Driver gains `list`, which reads every place of the universe with its display name, description and server size. `planImport` lists places (kind `place`, new type `ImportItemKind`) and marks the universe's root place with `root: true`. A selected place writes a root `places` entry with its live display name (without the source Environment's display-name prefix), description and server size, and no `filePath`, plus a `placeId` line on each linked Environment's overlay (new config edit `declarePlaceId`). Places link across Environments like other Kinds; a linked place's display name is compared with that Environment's prefix. A place must be linked in every other Environment, because a place entry needs a `placeId` in each one; otherwise it is refused with `placeNotLinked`.
