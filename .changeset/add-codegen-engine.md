---
"@bedrock-rbx/core": minor
---

Add an opt-in codegen engine. When `codegen.enabled` is set in config and an `emit` function is supplied to `deploy()`, bedrock assembles the current state of every declared environment after a successful state write and writes the emitter's returned files through an injected writer (node-fs by default, rooted at `codegen.output`). A partial apply still emits the keys that resolved while the deploy returns `applyFailed`. Surfaces the `Emitter`/`EmitInput`/`CodegenFile` contract, the `CodegenWriterPort` with `createFsCodegenWriter`, and the `CodegenConfig`, `CodegenError`, and `CodegenWriteError` types from the public API.
