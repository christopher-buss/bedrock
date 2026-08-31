---
"@bedrock-rbx/core": minor
---

Manage a place's configuration without uploading a place file. `filePath` on a
`places` entry is now optional; an entry that omits it is reconciled through the
metadata PATCH alone, publishes no version, and needs no build step.
