---
"@bedrock-rbx/core": patch
"@bedrock-rbx/ocale": patch
"@bedrock-rbx/state-s3": patch
---

Add the opt-in `orphans: "retire"` policy to retire resources removed from config after resolving renames. The default remains `"error"`; universe removal and root-place retirement remain protected.
