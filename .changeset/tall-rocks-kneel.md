---
"@bedrock-rbx/core": minor
---

Add Luau types and checked authoring for every resource kind, including nested
entries, unknown keys, state backends, and universe identity placement.
`Config<Actual>` and `EnvironmentEntry<Actual>` now require results from
`defineConfig(value)` and `defineEnvironment(value)`; raw annotations cannot
bypass validation. Use `bedrock.none` and `bedrock.gistBackend` for singleton
values in generic factory calls. The existing string wire values are unchanged.
