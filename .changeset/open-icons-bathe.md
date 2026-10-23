---
"@bedrock-rbx/core": minor
---

Add `none` (written `"$none"` in YAML, JSON and Luau) to turn a field off. It works on a game pass or developer product `price`, the universe `privateServerPriceRobux`, and each universe social link, at the root and in an environment overlay. An overlay now merges by key: a field it omits keeps the root value, and `none` turns the field off in that environment only. Breaking: a resource field set to `null` or `undefined` now fails the load, in the main file and in every `extends` layer, and the `Redacted*Override` types no longer accept `undefined` on a field. A root universe config that cleared `privateServerPriceRobux` or a social link with `undefined` must write `none` instead. A text field whose value is literally `$none` now fails validation. `ResourceEntryByKind` (`gamePass`, `developerProduct`, `universe`) and `ResolvedUniverseEntry` now carry the post-merge shapes: they hold no `none`, and an optional field may be `undefined`.
