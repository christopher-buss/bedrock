---
"@bedrock-rbx/core": minor
---

An environment overlay that sets a field to `undefined` now clears the field inherited from the root config, instead of keeping the root value. For example, `price: undefined` on a game pass or developer product overlay takes it off sale in that environment. A field the overlay omits still inherits the root value. Only TypeScript and JavaScript configs can express `undefined`; YAML, JSON and Luau configs cannot.
