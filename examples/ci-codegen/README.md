# CI + codegen example

The same project as [`../minimal`](../minimal), taken to where a real
multi-environment game sits: a deploy override that supplies its own build step
and emitter, generated TypeScript instead of a Luau table, and a GitHub Actions
workflow that deploys and commits the regenerated ids back to `main`.

Read [`../minimal`](../minimal) first if the deploy stages are new to you.

## What it shows

- A [`.bedrock/deploy.ts`](.bedrock/deploy.ts) override — the programmatic entry
  point the CLI hands control to.
- A custom [emitter](.bedrock/codegen/emit.ts) that generates typed TypeScript
  and resolves ids per environment at runtime.
- Reading real names and prices through redaction with `codegenViewOf` and
  `realValue`, so an environment deployed with placeholder storefront content
  still generates the values you declared.
- A [build step](.bedrock/build/build-place.ts) that picks its Rojo project from
  the environment being deployed.
- A [deploy workflow](.github/workflows/deploy.yaml) built on the published
  Bedrock actions.

## Layout

| Path                             | Role                                                     |
| -------------------------------- | -------------------------------------------------------- |
| `bedrock.config.ts`              | Resources, two environments, `codegen.output`.           |
| `.bedrock/deploy.ts`             | Override the CLI spawns instead of its built-in deploy.  |
| `.bedrock/build/build-place.ts`  | Compiles and builds the place. Pure of Bedrock concerns. |
| `.bedrock/codegen/emit.ts`       | Deploy state in, source files out. Pure function.        |
| `src/shared/assets/resources.ts` | Generated. Committed, and reflowed by CI.                |
| `src/server/main.server.ts`      | Resolves ids from `game.GameId` at runtime.              |
| `.github/workflows/deploy.yaml`  | Copy to your repository root to use.                     |

## Why an override

A config file cannot hold functions, so anything Bedrock has to _call_ —
building a place, generating source, reporting progress — is passed to
`deploy()` in code. `.bedrock/deploy.ts` is where that wiring lives.

The CLI looks for the file by path. When it exists, `bedrock deploy --env X`
spawns it with `--env X` in argv and the credentials in the environment, instead
of running its own deploy. Nothing else changes: the same command works locally
and in CI, whether or not an override is present.

The pure-config path is still available for the build step alone — drop a
`.bedrock/build.ts` and the CLI injects it, no `deploy.ts` needed. That is what
[`../minimal`](../minimal) does. Reach for `deploy.ts` when you need a custom
emitter or want to hold the result in your hands.

## Why the deploy commits to your branch

Codegen rewrites `src/shared/assets` during the deploy. Those files are the
game's source of truth for asset ids, so they have to end up on the branch —
otherwise the next build regenerates them from scratch and the diff never
settles.

The `deploy` action does that in one composite:

1. Runs `bedrock deploy --env production`, which provisions, generates, builds,
   and publishes.
2. Mints a short-lived installation token from your GitHub App.
3. Commits and pushes only the files that changed under `paths`, retrying if the
   branch tip moved.

The default commit message carries `[skip ci]` so the push does not trigger the
workflow again.

The token matters because the built-in `GITHUB_TOKEN` cannot push to a protected
`main`. The push needs an identity allowed to bypass branch protection, which is
why the composite mints one from a GitHub App you own.
[Set up the deploy bot](../../packages/actions/README.md#set-up-the-deploy-bot)
walks through creating it. If you already have a write-capable token, pass
`commit-token` instead of the `app-*` inputs; with neither, the commit-back step
is skipped and the deploy still runs.

## Secrets the workflow needs

| Secret                   | What it is                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `BEDROCK_API_KEY`        | Open Cloud API key with universe, place, and monetization scopes for your universe. |
| `BEDROCK_GIST_TOKEN`     | GitHub token with `gist` scope; Bedrock reads and writes deployed state through it. |
| `DEPLOY_APP_CLIENT_ID`   | Client id of your deploy GitHub App.                                                |
| `DEPLOY_APP_PRIVATE_KEY` | Full contents of that app's `.pem` private key.                                     |

The workflow pins actions by tag for readability. Pin by commit SHA in a real
repository.

## Redaction

`development` sets `redacted: true`, so Bedrock pushes placeholder name,
description, and price to Roblox for that environment while recording the real
values in a sibling of the state file. The emitter reads them back with
`realValue(view.name)`, so the generated source carries the real values in both
environments even though only production shows them on the storefront.

Drop `redacted` and nothing else changes — the same emitter code keeps working,
because `codegenViewOf` returns the declared value when there is nothing to see
through.

## Adapting it

- Replace every placeholder id in `bedrock.config.ts`, and the `gistId`.
- Supply `assets/icons/vip-pass.png`, or drop the `passes` block.
- Add environments by adding a key under `environments`. The emitter picks them
  up with no change: it generates one `GameId` member per environment that has
  deployed at least once.
- To generate something else, edit `emit.ts`. It is a pure function of the
  deploy state, so a unit test over it is a plain input/output comparison.
