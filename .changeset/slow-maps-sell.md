---
"@bedrock-rbx/core": patch
---

A migrate prompt field the user skips now records no answer, so an optional `state` key stays out of the block a **Backend** is built from rather than reaching its schema as an empty string. An answer holding nothing but whitespace counts as skipped, on the same terms a required field's own validation rejects one.
