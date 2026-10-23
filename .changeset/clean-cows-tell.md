---
"@bedrock-rbx/core": minor
---

Accept a `credential` option on `deploy`, `provision`, `publish` and `buildDefaultRegistry`. The default registry builds every Open Cloud client from it and does not read `BEDROCK_API_KEY`. `credential` and `registry` are mutually exclusive. `DeployOptions`, `ProvisionOptions` and `PublishOptions` are now type aliases, so `interface X extends DeployOptions` no longer compiles; use `type X = DeployOptions & { ... }`.
