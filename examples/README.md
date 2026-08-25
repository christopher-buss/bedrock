# Examples

Reference projects showing how a game repository uses Bedrock. Neither deploys
as-is: every Roblox id in them is a placeholder, because Open Cloud cannot mint
a universe or a place. Replace the ids with an experience you own.

| Example                    | Toolchain   | Shows                                                                  |
| -------------------------- | ----------- | ---------------------------------------------------------------------- |
| [`minimal`](minimal)       | Rojo + Luau | Config, the built-in Luau emitter, a build override. Deployed by hand. |
| [`ci-codegen`](ci-codegen) | roblox-ts   | A deploy override, a custom emitter, and a GitHub Actions deploy.      |

Read `minimal` first — it introduces the deploy stages that `ci-codegen`
assumes.

## What they have in common

Both declare their resources in `bedrock.config.ts`, keep deployed state in a
GitHub Gist, and enable codegen so the ids Roblox assigns are written back out
as source their game code reads by key.

They differ in how much they hand to Bedrock in code:

- `minimal` supplies only a build script at a known path and lets the CLI do
  everything else, including generating a Luau table with the built-in emitter.
- `ci-codegen` supplies a `.bedrock/deploy.ts` override that calls `deploy()`
  itself, passing its own build step and emitter. That is the only way to
  customize what codegen writes, since a config file cannot hold functions.

## Keeping them honest

Both are workspace packages, so `pnpm typecheck` compiles their config and
`.bedrock/` sources against the real `@bedrock-rbx/core` API and CI fails when
an example drifts. Their game sources under `src/` are excluded: Luau and
roblox-ts compile with a different toolchain than the Node scripts beside them.

The generated files committed in each example (`resources.luau`, `resources.ts`)
are illustrative output, not test fixtures.

In your own project, install from npm rather than using the `workspace:*`
dependency these use:

```bash
pnpm add @bedrock-rbx/core
```
