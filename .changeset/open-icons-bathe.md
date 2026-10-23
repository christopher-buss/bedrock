---
"@bedrock-rbx/core": minor
---

Add `none` (written `"$none"` in YAML, JSON and Luau) to turn a field off. It works on a game pass or developer product `price`, the universe `privateServerPriceRobux`, and each universe social link, at the root and in an environment overlay. An overlay now merges by key: a field it omits keeps the root value, and `none` turns the field off in that environment only. Breaking: a resource field set to `null` or `undefined` now fails the load, in the main file and in every `extends` layer. A root universe config that cleared `privateServerPriceRobux` or a social link with `undefined` must write `none` instead. Text fields reject `"$none"`.
