# Examples

Reference projects showing how a game repository uses Bedrock. Neither deploys
as-is: every Roblox id in them is a placeholder, because Open Cloud cannot mint
a universe or a place. Replace the ids with an experience you own.

| Example                    | Toolchain   | Shows                                                             |
| -------------------------- | ----------- | ----------------------------------------------------------------- |
| [`minimal`](minimal)       | Rojo + Luau | A Luau config and the built-in emitter. Three CLI commands.       |
| [`ci-codegen`](ci-codegen) | roblox-ts   | A deploy override, a custom emitter, and a GitHub Actions deploy. |

Read `minimal` first — it introduces the deploy stages that `ci-codegen`
assumes.

Both keep deployed state in a GitHub Gist and enable codegen, so the ids Roblox
assigns are written back out as source the game code reads by key. The committed
emitter output in each (`resources.luau`, `resources.ts`) is real generated
content, not written by hand.

`pnpm typecheck` compiles `ci-codegen`'s `bedrock.config.ts` and `.bedrock/`
sources against the real `@bedrock-rbx/core` API. Its `src/` is covered only by
`pnpm build`, which runs `rbxtsc`, because roblox-ts pins its own TypeScript.
`minimal` is Luau throughout and has neither step; its config is validated at
load time.

In your own project, install from npm rather than using the `workspace:*`
dependency these use:

```bash
pnpm add @bedrock-rbx/core
```
