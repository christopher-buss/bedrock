---
"@bedrock-rbx/core": patch
---

Add declarative `universe.visibility: "public" | "private"`, with private-first
and public-last ordering, durable transition recovery, and Mantle activation
migration. Public activation waits for successful deployment work, including
matching provision and place publishing in split pipelines. Omission leaves
visibility unmanaged; declaring it again after an omitted run reconciles it.

Return independent declarative configuration data across repeated loads while
preserving opaque plugin options and callbacks. Support opaque backend options
during visibility preparation.
