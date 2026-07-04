---
"@bedrock-rbx/core": minor
---

**Breaking:** `deploy` is now the fused composition of `provision → build → publish`, and the in-process rebuild hook is removed.

- `DeployOptions.rebuild` and `DeployOptions.clearPendingRebuild` are **removed** (deleted, not deprecated), along with the `RebuildHook` and `RebuiltPlace` types and the `rebuildHookThrew` / `pendingRebuildWithoutHook` error variants. `.bedrock/build.ts` is the single build mechanism.
- For a codegen project, `deploy` always builds after codegen: it runs the provision stage (mint assets, checkpoint with every declared place marked `pendingRebuild`, run the emitter), invokes the new build step once, and publishes the on-disk artifacts. The `codegenHash`-gated "rebuild vs. reuse-pre-built" branch is retired; `codegenHash` is bookkeeping only. No-codegen projects still publish pre-built place files in a single pass.
- New `DeployOptions.build` (`BuildStep`) supplies the build programmatically; the CLI injects one that spawns the discovered `.bedrock/build.ts` override on the same credential/argv contract as `bedrock build`. Codegen enabled with places declared but no build step available is a `missingBuildStep` error; a throwing build step surfaces `buildFailed` with the checkpoint marker persisted, self-healing on the next green run.
- No-op deploys upload nothing via the place file-hash comparison, and a green deploy settles the `pendingRebuild` marker (republished and already-current places clear it; only failed places keep it).
- `bedrock diff` now reports persistent `pendingRebuild` markers as drift ("N place(s) minted but unpublished"), and `DiffPreview` gains a required `pendingRebuild` key list.
