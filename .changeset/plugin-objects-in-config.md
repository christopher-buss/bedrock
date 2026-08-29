---
"@bedrock-rbx/core": patch
"@bedrock-rbx/state-s3": patch
---

Accept a plugin object in the config's `plugins` list, alongside the module specifiers it already took. A config authored in TypeScript can import the plugin and list it directly, which types the `state` block from what that plugin declares: `import { bedrockS3Plugin } from "@bedrock-rbx/state-s3"` then `plugins: [bedrockS3Plugin]` completes `bucket`, `region`, and every other key the backend declares, and rejects a misspelled key, a missing required key, or a `backend` that no listed plugin claims at compile time rather than at deploy time. The union closes around the built-in backend and the ones the listed plugins declare; listing a plugin by specifier leaves the block open as before, which is what the YAML, JSON, and Luau formats get. `BedrockPlugin` now requires a `name`, which is how a diagnostic refers to a plugin the config listed no specifier for, and `loadConfig` resolves every entry to the name of the plugin that loaded.
