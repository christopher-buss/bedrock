# CI + codegen example

This example takes the [`../minimal`](../minimal) project and gives it more than
one environment. It adds a deploy override with its own build step and emitter,
generates TypeScript instead of a Luau table, and uses a GitHub Actions workflow
that commits the regenerated IDs back to `main`. If the deploy stages are new to
you, read [`../minimal`](../minimal) first.

## Layout

| Path                             | Role                                                     |
| -------------------------------- | -------------------------------------------------------- |
| `bedrock.config.ts`              | Resources, two environments, `codegen.output`.           |
| `.bedrock/deploy.ts`             | Override the CLI spawns instead of its built-in deploy.  |
| `.bedrock/build/build-place.ts`  | Compiles the sources and builds the place artifact.      |
| `.bedrock/codegen/emit.ts`       | Takes deploy state, returns source files. Pure function. |
| `src/shared/assets/resources.ts` | Generated. Committed, and rewritten by CI.               |
| `src/server/main.server.ts`      | Looks up IDs from `game.GameId` at runtime.              |
| `src/dev/dev-only.server.ts`     | Mounted by the development Rojo project only.            |
| `.github/workflows/deploy.yaml`  | Copy it to your repository root to use it.               |

## Building it

```bash
pnpm --filter @bedrock-rbx/example-ci-codegen build
```

During a deploy, [`build-place.ts`](.bedrock/build/build-place.ts) runs the same
command and picks the Rojo project for the environment you're deploying.
roblox-ts reads [`tsconfig.roblox.json`](tsconfig.roblox.json), not
`tsconfig.json`. That's because `tsconfig.json` is the Node-side program for
`.bedrock/`, and rbxtsc needs its `typeRoots` to resolve against its own
config's directory.

## Why an override

A config file can't hold functions. So anything Bedrock has to _call_, such as
building a place, generating source, or reporting progress, gets passed to
`deploy()` in code. That's what [`.bedrock/deploy.ts`](.bedrock/deploy.ts) does,
and it includes the custom [emitter](.bedrock/codegen/emit.ts). When the file
exists, `bedrock deploy --env X` runs it with `--env X` in argv and your
credentials in the environment. You use the same command locally and in CI.

If you only need a build step, add a `.bedrock/build.ts` and the CLI picks it
up. You only need `deploy.ts` when you also want a custom emitter.

## Why the deploy commits to your branch

Codegen rewrites `src/shared/assets` during the deploy, and your game reads its
asset IDs from those files. So they have to land on the branch. If they don't,
the next build regenerates them from scratch and the diff never settles.

The `deploy` action runs `bedrock deploy --env production`. It then gets a
short-lived installation token from your GitHub App and commits only the files
that changed under `paths`. If someone pushed to the branch in the meantime, it
retries. The commit message includes `[skip ci]`, so the push doesn't trigger
the workflow again.

You need the App token because the built-in `GITHUB_TOKEN` can't push to a
protected `main`.
[Set up the deploy bot](../../packages/actions/README.md#set-up-the-deploy-bot)
walks you through creating one. If you already have a token that can write to
the repository, pass it as `commit-token` instead. If you pass neither, the
deploy still runs, but it skips the commit-back.

## Secrets the workflow needs

| Secret                   | What it is                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `BEDROCK_API_KEY`        | Open Cloud API key with universe, place, and monetization scopes for your universe. |
| `BEDROCK_GIST_TOKEN`     | GitHub token with `gist` scope; Bedrock reads and writes deployed state through it. |
| `DEPLOY_APP_CLIENT_ID`   | Client id of your deploy GitHub App.                                                |
| `DEPLOY_APP_PRIVATE_KEY` | Full contents of that app's `.pem` private key.                                     |

Every action in the workflow is pinned to a commit SHA, including the Bedrock
deploy action. A tag can be moved to a different commit, and this job hands the
action your Open Cloud API key and your GitHub App private key. The pin only
covers the outer reference, though. The deploy composite finds its own
commit-back step through the `actions-v0.1.1` tag, so pinning fixes which
composite you get, not every step it runs.

## Redaction

The `development` environment sets `redacted: true`. For that environment,
Bedrock sends a placeholder name, description, and price to Roblox, and saves
the real values in the state file as a `$realDisplay` sibling of each resource.
The emitter reads them back with `codegenViewOf` and `realValue`. So your
generated source has the real values in both environments, but only production
shows them on the storefront.

If you remove `redacted`, the emitter still works without changes, because
`codegenViewOf` returns the declared value when nothing is redacted.

## Adapting it

- Replace every placeholder ID in `bedrock.config.ts`, and the `gistId`.
- Replace `assets/icons/vip-pass.png` with a real 512x512 icon, or remove the
  `passes` block.
- To add an environment, add a key under `environments`. The emitter generates
  one `GameId` member for each environment that has deployed at least once.
- To generate something else, edit `emit.ts`. It's a pure function of the deploy
  state, so testing it is just comparing input to output.
