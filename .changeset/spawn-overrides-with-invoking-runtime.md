---
"@bedrock-rbx/core": minor
---

CLI overrides now run on the runtime that invoked the CLI instead of requiring Bun.

`bedrock <command>` dispatches a `.bedrock/<command>.ts` override by spawning
`process.execPath` (the same binary already executing the CLI) rather than a
hardcoded `bun` looked up on `PATH`. Running the CLI through node no longer
requires a Bun install, and running it through Bun keeps Bun.

**Breaking** for projects whose overrides relied on the implicit Bun runtime:
under node the override must use erasable-syntax TypeScript (no enums or
namespaces) and relative imports must spell out their `.ts` extension. The
package's supported node range (>= 24.12) executes TypeScript natively. Invoke
the CLI through Bun (`bunx bedrock ...`) to keep the previous behavior.
