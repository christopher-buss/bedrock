---
"@bedrock-rbx/core": patch
---

Complete the **Migrate descriptor**: a `StateBackendMigrateSource` may now declare `toStateConfig`, which translates the coordinates it fetched the previous tool's state from into the `state` keys bedrock records for that **Backend**. When a user fetches through a plugin **Backend** and then migrates onto that same **Backend**, the translated block is what the emitted config carries, so the bucket the foreign state lived in is named once rather than answered again under `migratePrompts`. Declaring it is optional: a **Backend** without a translation, or a migration onto a different **Backend**, asks its `migratePrompts` exactly as before.
