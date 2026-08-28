---
"@bedrock-rbx/core": patch
---

A migrate prompt field the user skips now records no answer, so an optional `state` key stays out of the block a **Backend** is built from rather than reaching its schema as an empty string. An answer holding nothing but whitespace counts as skipped, on the same terms a required field's own validation rejects one.

`StateBackendMigrateSource.readBytes` is now handed the `fetch` seam a **Backend**'s builder already receives, so a plugin fetching another tool's state over HTTP routes through the transport its caller injected and its tests drive it against a fake one. The seam is optional, and a reader falls back to the runtime's own `fetch` exactly as an adapter does.
