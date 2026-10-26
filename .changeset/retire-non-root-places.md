---
"@bedrock-rbx/core": patch
"@bedrock-rbx/ocale": patch
"@bedrock-rbx/state-s3": patch
---

Retire non-root places with `retired: true`: replace the display name, clear the description, and reduce server size to one before dropping state. Refuse root-place retirement and retirement of a place still adopted by another config entry. Add `PlacesClient.get` to read place metadata.
