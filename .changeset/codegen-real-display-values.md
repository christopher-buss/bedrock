---
"@bedrock-rbx/core": minor
---

Expose real (pre-redaction) display values to codegen emitters. A redacted resource (ADR-024) previously persisted only the pushed placeholder values, so an `emit` function could not recover the real name, price, or description to write into generated game source. Bedrock now persists the real values in a diff-ignored `$realDisplay` sibling on each resource in the state file — `serializeStateFile`/`parseStateFile` own that mapping, while `diff` and the state merge stay redaction-blind. Emitters read a co-located per-field view: `codegenView(resource, realDisplay)` widens each redactable field to `Field<T> = T | { value, redacted }`, and the exported `realValue` / `pushedValue` / `isRedacted` helpers narrow it without hand-rolling the union. Non-redacted fields stay plain scalars. Surfaces `codegenView`, `realValue`, `pushedValue`, `isRedacted`, and the `Field`, `CodegenView`, and `ResourceRealDisplay` types from the public API.
