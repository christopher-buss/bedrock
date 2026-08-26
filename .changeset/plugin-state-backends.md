---
"@bedrock-rbx/core": patch
---

Let a plugin declare a state **Backend**: a `BedrockPlugin` default-exports `stateBackends`, each entry claiming a `state.backend` name and supplying an arktype schema fragment for that backend's own `state` keys. With such a plugin listed under `plugins`, `state: { backend: "s3", bucket: "my-bucket" }` validates, while a key neither the plugin nor core declared is still rejected and a bad value for a plugin's own key is attributed to that field. Backend names resolve to exactly one declaration: a name claimed by two loaded plugins, or by a plugin and a builtin, fails the config load with a `stateBackendConflict` error naming both module specifiers, so installing a package cannot silently redirect where state lives. `createConfigValidator` compiles a validator for a given set of plugin declarations; `validateConfig` keeps its signature as the validator for core's own backends.
