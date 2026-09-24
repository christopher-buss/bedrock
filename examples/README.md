# Examples

These are reference projects that show how a game repository uses Bedrock.
Neither one deploys as-is. Every Roblox ID in them is a placeholder, because
Open Cloud can't create a universe or a place for you. To try one, swap the IDs
for an experience you own.

| Example                    | Toolchain   | Shows                                                             |
| -------------------------- | ----------- | ----------------------------------------------------------------- |
| [`minimal`](minimal)       | Rojo + Luau | A Luau config and the built-in emitter. Three CLI commands.       |
| [`ci-codegen`](ci-codegen) | roblox-ts   | A deploy override, a custom emitter, and a GitHub Actions deploy. |

Start with `minimal`. It introduces the deploy stages that `ci-codegen` builds
on.

Both examples keep their deployed state in a GitHub Gist and have codegen turned
on. When Roblox assigns an ID, Bedrock writes it back out as source code, and
your game code reads it by key. The generated files committed in each
(`resources.luau` and `resources.ts`) are real Bedrock output, not written by
hand.

If you're working on Bedrock itself, `pnpm typecheck` compiles `ci-codegen`'s
`bedrock.config.ts` and `.bedrock/` sources against the real `@bedrock-rbx/core`
API. Its `src/` only gets checked by `pnpm build`, which runs `rbxtsc`, because
roblox-ts pins its own TypeScript version. `minimal` is Luau all the way
through, so it has neither step. Bedrock validates its config when it loads it.

These examples depend on `@bedrock-rbx/core` through `workspace:*`. In your own
project, install it from npm instead:

```bash
pnpm add -D @bedrock-rbx/core
```

If your project has no `package.json`, the [main README](../README.md#with-mise)
shows how to install Bedrock with mise.
