---
"@bedrock-rbx/core": minor
---

Add two helpers for writing custom codegen emitters. `findResource(resources, { kind, key })` looks up a single resource in `state.resources`, narrowed to its kind so `outputs` and kind-specific fields are typed without a hand-written predicate; omit `key` to take the first resource of the kind. `codegenViewOf(state, resource)` projects a resource into its redaction-aware codegen view, resolving the resource's `realDisplay` sibling from state for you, so an emitter no longer re-derives the internal `kind:key` composite to call `codegenView`.
