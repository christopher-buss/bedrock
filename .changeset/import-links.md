---
"@bedrock-rbx/core": minor
---

`bedrock import` now links each imported Key in every other Environment. After the Key screens, one link screen per Environment suggests the live item with the same name (the display-name prefix is removed before the names are compared), lets you pick another item by hand, or leaves the Key unlinked so the next deploy creates it there. The summary shows each field where a linked item differs from config; the next deploy applies the config values. A link writes only an `importId` line on that Environment's overlay. An item that no other Environment can link to is shown as not importable yet. With `--yes`, `--link auto` links each `--select` item by name and `--link none` (the default) links nothing. `planImport` takes the other Environments' live lists as `linkLive` and the chosen links as `ImportSelection.links`, and returns `links` with the candidates and their field differences.
