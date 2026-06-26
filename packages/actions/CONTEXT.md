# @bedrock-rbx/actions

GitHub Actions that deploy a Roblox project with Bedrock and persist the
regenerated codegen back to the repository. This context owns the CI/git
vocabulary of that pipeline — distinct from Open Cloud (`@bedrock-rbx/ocale`)
and the IaC engine (`@bedrock-rbx/core`).

## Language

**Commit-back**:
Persisting the codegen files a deploy regenerated back onto the deploy branch.
The capability and the primitive action that performs it.
_Avoid_: write-back, sync.

**Reflow**:
The race-safe mechanism inside commit-back: snapshot the changed files, reset
onto the latest branch tip, restore only those files (codegen ids overwrite —
never a merge), commit, and push, retrying when the tip moves.
_Avoid_: rebase, merge (it is neither).

**Generated set**:
The exact files that changed under `codegen.output` after a deploy — what
commit-back reflows. Discovered by a path-scoped `git status --porcelain` (so a
first deploy's newly created files count too), never a hand-kept list.
_Avoid_: dirty files, artifacts.

**Deploy App**:
The per-repository GitHub App a consumer creates and owns to mint the
write-capable token commit-back pushes with. There is no shared, hosted App.
_Avoid_: bot, the Bedrock bot, integration.

**Primitive**:
The standalone commit-back action — the reusable reflow, composed by users who
want their own pipeline.

**Composite**:
The drop-in deploy action that wires deploy → token → commit-back around the
primitive.
