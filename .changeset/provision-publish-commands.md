---
"@bedrock-rbx/core": minor
---

Add `provision` and `publish` commands that split the two-phase deploy at its checkpoint seam. `provision` runs the asset stage plus codegen (minting IDs, persisting mutable asset fields, running the emitter, and setting the `pendingRebuild` marker) without building or publishing any place. `publish` is a pure uploader that publishes the on-disk artifact for each `pendingRebuild` place (deduped by file hash), clearing the marker per republished place, with no mint, codegen, or build. Both are exposed programmatically (`provision(options)`, `publish(options)`) and as CLI subcommands (`bedrock provision`, `bedrock publish`), each overridable via `.bedrock/provision.ts` / `.bedrock/publish.ts`. `deploy` behaviour is unchanged.
