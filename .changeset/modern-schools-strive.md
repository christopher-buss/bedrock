---
"@bedrock-rbx/core": minor
---

An environment overlay that sets a field to `undefined` now clears the field inherited from the root config, instead of keeping the root value: that environment acts as if the root never set the field. For example, `price: undefined` on a game pass or developer product overlay takes it off sale in that environment. A field the overlay omits still inherits the root value. YAML and JSON configs clear a field with `null`: the config loader now reads every `null` as `undefined` before validation, and a `null` on a required field fails validation with a message that names `null`. Luau configs cannot clear an inherited field, because a Luau table cannot hold a key whose value is `nil`.
