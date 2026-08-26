# Context Map

This is a multi-context monorepo. Each package owns its own domain language;
this file points at the per-package `CONTEXT.md` glossaries.

## Contexts

- **`@bedrock-rbx/ocale`** —
  [`packages/open-cloud/CONTEXT.md`](packages/open-cloud/CONTEXT.md) — Roblox
  Open Cloud HTTP client vocabulary (Domain, Resource, Operation, Operation
  Group, Wire).
- **`@bedrock-rbx/core`** —
  [`packages/bedrock/CONTEXT.md`](packages/bedrock/CONTEXT.md) — IaC engine
  vocabulary (Resource, Kind, Desired/Current state, Operation,
  Diff/Apply/Deploy, Driver, State port).
- **`@bedrock-rbx/state-s3`** —
  [`packages/state-s3/CONTEXT.md`](packages/state-s3/CONTEXT.md) — S3 state
  backend plugin vocabulary (Object, Prefix, Store, Refusal, Transport).
- **`@bedrock-rbx/actions`** —
  [`packages/actions/CONTEXT.md`](packages/actions/CONTEXT.md) —
  deploy/commit-back CI vocabulary (Commit-back, Reflow, Generated set, Deploy
  App, Primitive/Composite).
- **`@bedrock-rbx/testing`** — `packages/testing/CONTEXT.md` _(not yet written)_
  — shared test helpers and matchers.
- **`@bedrock-rbx/vite-config`** — _config-only, no domain language._
- **`@bedrock-rbx/typescript-config`** — _config-only, no domain language._

## Relationships

- **`@bedrock-rbx/core` → `@bedrock-rbx/ocale`**: core consumes ocale as a
  workspace dependency for all Roblox Open Cloud access; core never talks HTTP
  directly. Data crosses as ocale wire types in, core domain types out.
- **`@bedrock-rbx/state-s3` → `@bedrock-rbx/core`**: a plugin core loads by the
  specifier a user names under `plugins`. It reaches core only through the
  published plugin contract and the state-file helpers, and holds no privileged
  path a third-party backend could not take.
- **`@bedrock-rbx/actions` → `@bedrock-rbx/core`**: the actions invoke the core
  CLI to run a deploy, then reflow the `codegen.output` files core wrote. The
  seam is the filesystem (generated set) and the process boundary, not a code
  import.
- **`@bedrock-rbx/testing`**: shared fakes/matchers the other contexts import in
  tests only; carries no runtime domain language of its own.
- **`vite-config` / `typescript-config`**: build/type configuration consumed by
  every package; no domain data crosses.

## System-wide decisions

ADRs at [`docs/adr/`](docs/adr/) apply across all contexts. Per-package ADR
directories are not used.
