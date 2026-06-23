---
"@bedrock-rbx/core": minor
---

Add a zero-config default codegen emitter. When `codegen.enabled` is set and no `emit` override is supplied to `deploy()`, bedrock now writes `resources.luau` — a Luau module of deployed Roblox IDs keyed by environment, then resource key, then that resource's outputs (asset IDs, icon asset IDs, and the like, including the real IDs of redacted resources). Asset IDs are emitted as Luau number literals. Setting `codegen.typeDeclarations: true` also writes a `resources.d.ts` companion so roblox-ts consumers get type-safety over the same module. The output directory defaults to `.bedrock/generated` (consumed as `@bedrock/generated/resources`) when `codegen.output` is unset. The default emitter is exported as `createDefaultEmitter` so a custom `emit` can wrap rather than replace it.
