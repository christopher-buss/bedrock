# Context Map

This is a multi-context monorepo. Each package owns its own domain language; this file points at the per-package `CONTEXT.md` glossaries.

## Contexts

- **`@bedrock-rbx/ocale`** — [`packages/open-cloud/CONTEXT.md`](packages/open-cloud/CONTEXT.md) — Roblox Open Cloud HTTP client vocabulary (Domain, Resource, Operation, Operation Group, Wire).
- **`@bedrock-rbx/core`** — [`packages/bedrock/CONTEXT.md`](packages/bedrock/CONTEXT.md) — IaC engine vocabulary (Resource, Kind, Desired/Current state, Operation, Diff/Apply/Deploy, Driver, State port).
- **`@bedrock-rbx/actions`** — [`packages/actions/CONTEXT.md`](packages/actions/CONTEXT.md) — deploy/commit-back CI vocabulary (Commit-back, Reflow, Generated set, Deploy App, Primitive/Composite).
- **`@bedrock-rbx/testing`** — `packages/testing/CONTEXT.md` _(not yet written)_ — shared test helpers and matchers.
- **`@bedrock-rbx/vite-config`** — _config-only, no domain language._
- **`@bedrock-rbx/typescript-config`** — _config-only, no domain language._

## System-wide decisions

ADRs at [`docs/adr/`](docs/adr/) apply across all contexts. Per-package ADR directories are not used.
