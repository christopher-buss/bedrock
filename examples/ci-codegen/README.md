# CI + codegen example

This takes the [`../minimal`](../minimal) project multi-environment. It adds a
deploy override supplying its own build step and emitter, generated TypeScript
in place of a Luau table, and a GitHub Actions workflow that commits the
regenerated ids back to `main`. Read [`../minimal`](../minimal) first if the
deploy stages are new to you.

## Layout

| Path                             | Role                                                    |
| -------------------------------- | ------------------------------------------------------- |
| `bedrock.config.ts`              | Resources, two environments, `codegen.output`.          |
| `.bedrock/deploy.ts`             | Override the CLI spawns instead of its built-in deploy. |
| `.bedrock/build/build-place.ts`  | Compiles the sources and builds the place artifact.     |
| `.bedrock/codegen/emit.ts`       | Deploy state in, source files out. Pure function.       |
| `src/shared/assets/resources.ts` | Generated. Committed, and rewritten by CI.              |
| `src/server/main.server.ts`      | Resolves ids from `game.GameId` at runtime.             |
| `src/dev/dev-only.server.ts`     | Mounted by the development Rojo project only.           |
| `.github/workflows/deploy.yaml`  | Copy to your repository root to use.                    |

## Building it

```bash
pnpm --filter @bedrock-rbx/example-ci-codegen build
```

[`build-place.ts`](.bedrock/build/build-place.ts) runs the same command during a
deploy, picking its Rojo project from the environment being deployed. roblox-ts
reads [`tsconfig.roblox.json`](tsconfig.roblox.json) rather than
`tsconfig.json`, which is the Node-side program for `.bedrock/`: rbxtsc requires
its `typeRoots` to resolve against its own config's directory.

## Why an override

A config file cannot hold functions, so anything Bedrock has to _call_ —
building a place, generating source, reporting progress — is passed to
`deploy()` in code. That is what [`.bedrock/deploy.ts`](.bedrock/deploy.ts) is,
custom [emitter](.bedrock/codegen/emit.ts) included. When the file exists,
`bedrock deploy --env X` spawns it with `--env X` in argv and the credentials in
the environment; the same command still works locally and in CI.

For a build step alone, drop a `.bedrock/build.ts` and the CLI injects it;
`deploy.ts` is for when you also need a custom emitter.

## Why the deploy commits to your branch

Codegen rewrites `src/shared/assets` during the deploy, and those files are the
game's source of truth for asset ids. They have to land on the branch, or the
next build regenerates them from scratch and the diff never settles. The
`deploy` action runs `bedrock deploy --env production`, mints a short-lived
installation token from your GitHub App, then commits only the changed files
under `paths`, retrying if the branch tip moved. Its commit message carries
`[skip ci]` so the push does not re-trigger the workflow.

The App token is there because the built-in `GITHUB_TOKEN` cannot push to a
protected `main`.
[Set up the deploy bot](../../packages/actions/README.md#set-up-the-deploy-bot)
covers creating it; pass `commit-token` instead if you already have a
write-capable token. With neither, the commit-back is skipped and the deploy
still runs.

## Secrets the workflow needs

| Secret                   | What it is                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `BEDROCK_API_KEY`        | Open Cloud API key with universe, place, and monetization scopes for your universe. |
| `BEDROCK_GIST_TOKEN`     | GitHub token with `gist` scope; Bedrock reads and writes deployed state through it. |
| `DEPLOY_APP_CLIENT_ID`   | Client id of your deploy GitHub App.                                                |
| `DEPLOY_APP_PRIVATE_KEY` | Full contents of that app's `.pem` private key.                                     |

Every action is pinned by commit SHA, the Bedrock deploy action included: a tag
can be repointed, and this job hands the action an Open Cloud API key and a
GitHub App private key. The pin stops at the outer reference. The deploy
composite resolves its own commit-back step through the `actions-v0.1.1` tag, so
pinning freezes which composite you get, not every step it runs.

## Redaction

`development` sets `redacted: true`: Bedrock pushes a placeholder name,
description, and price to Roblox for that environment and records the real
values as a `$realDisplay` sibling of each resource inside the state file. The
emitter reads them back with `codegenViewOf` and `realValue`, so generated
source carries the real values in both environments while only production shows
them on the storefront. Drop `redacted` and the emitter is unchanged, because
`codegenViewOf` returns the declared value when there is nothing to see through.

## Adapting it

- Replace every placeholder id in `bedrock.config.ts`, and the `gistId`.
- Replace `assets/icons/vip-pass.png` with a real 512x512 icon, or drop the
  `passes` block.
- Add a key under `environments`; the emitter generates one `GameId` member per
  environment that has deployed at least once.
- To generate something else, edit `emit.ts`. It is a pure function of the
  deploy state, so a test over it is an input/output comparison.
