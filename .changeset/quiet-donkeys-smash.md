---
"@bedrock-rbx/core": patch
---

Reject an incomplete developer product instead of deploying it

A product declared only under `environments.<name>.products` had no root entry to
fall through to, so a missing `name` or `description` was never caught and the
product reached Roblox with placeholder-free empty fields. `selectEnvironment`
and `selectMergedEnvironment` now return the new `incompleteProductEntry` error
for that case, matching the existing behaviour for game passes and places.

`IncompleteProductEntryError` joins the `SelectEnvironmentError`, `DeployError`,
and `PreviewDiffError` unions, and the CLI renders it as
`product '<key>' is missing '<field>' under environment '<env>'`.
