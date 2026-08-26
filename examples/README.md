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
as source their game code reads by key. Each example README explains where the
two diverge.

## Keeping them honest

Both are workspace packages, so `pnpm typecheck` compiles their
`bedrock.config.ts` and `.bedrock/` sources against the real `@bedrock-rbx/core`
API. Those files cannot drift without CI failing.

Their game sources under `src/` are checked by nothing here — Luau and roblox-ts
need a Roblox toolchain this repo does not run. Treat those files as
illustrative, along with the committed emitter output (`resources.luau`,
`resources.ts`).

In your own project, install from npm rather than using the `workspace:*`
dependency these use:

```bash
pnpm add @bedrock-rbx/core
```
