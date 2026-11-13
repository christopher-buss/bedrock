---
"@bedrock-rbx/core": minor
---

**Breaking:** `deploy` and `provision` now check live state by default and revert edits made outside bedrock. When an Open Cloud credential is available, they read each tracked resource from Roblox before they plan, and a managed field that differs from saved State is restored to config. A failed live read now stops the run before any write. Pass `--no-live` (or `live: false`) to keep the old behaviour of comparing against saved State only, `--live` (or `live: true`) to require the check, and `--fail-on-out-of-band-edit` (or `failOnOutOfBandEdit: true`) to refuse instead of reverting. Progress and summaries count reverts separately. `ProgressEvent` gains a `liveCheck` member, so an exhaustive `switch` over its `kind` needs a new case.
