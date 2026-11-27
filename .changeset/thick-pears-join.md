---
"@bedrock-rbx/core": patch
---

The Mantle migrator now folds `experienceIcon_singleton` into `universe.icon` instead of reporting it as `blocked`. The migrated state records the icon asset ID, the icon file hash and the start place that holds the icon, so the first deploy after migration does no upload.
