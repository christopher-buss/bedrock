# Minimal example

The smallest Bedrock project that deploys and generates source: one Luau config
file and three CLI commands. No TypeScript, no override, no CI.

## What it shows

- Declaring a universe, a place, and a developer product in
  [`bedrock.config.luau`](bedrock.config.luau).
- Codegen with no emitter code — the built-in emitter writes
  [`.bedrock/generated/resources.luau`](.bedrock/generated/resources.luau).
- Reading a generated id from game code in
  [`src/server/init.server.luau`](src/server/init.server.luau).

## Layout

| Path                                | Role                                              |
| ----------------------------------- | ------------------------------------------------- |
| `bedrock.config.luau`               | What should exist on Roblox.                      |
| `.bedrock/generated/resources.luau` | Generated. Committed so game code can require it. |
| `default.project.json`              | Rojo project.                                     |
| `src/server/init.server.luau`       | Consumes a generated product id.                  |

Bedrock evaluates a `.luau` config with
[lute](https://github.com/luau-lang/lute), installed by this project's
`mise.toml`. TypeScript, JavaScript, YAML, and JSON configs need no extra tool.

## Deploying it

Replace the placeholders in `bedrock.config.luau`:

- `universeId` / `placeId`: an experience you own. Open Cloud cannot create
  either, so both must exist before the first deploy.
- `gistId`: a secret [GitHub Gist](https://gist.github.com) that holds the
  deployed state. Create an empty one and copy the id out of its URL.

Then set the two credentials:

```bash
export BEDROCK_API_KEY="<open-cloud-api-key>"
export BEDROCK_GITHUB_TOKEN="<github-token-with-gist-scope>"
```

`pnpm bedrock diff --env production` prints the operations a deploy would apply
and writes nothing. When it looks right, run the three stages in order:

```bash
pnpm bedrock provision --env production
rojo build default.project.json --output place.rbxl
pnpm bedrock publish --env production
```

## Why three commands

`provision` creates the universe and the developer product, so Roblox assigns
ids that did not exist when you last built, then regenerates `resources.luau`
from those ids. The place has to be rebuilt around the new file before it is
published, which is why `rojo build` sits between the two Bedrock commands.
Provisioned ids are written to state before the build runs, so a failed build
never loses them.

`bedrock deploy` fuses all three into one, but it can only run the build itself
if you hand it a build step: a `.bedrock/build.ts` override, which
[`../ci-codegen`](../ci-codegen) has and this example does not. Without codegen
enabled there is nothing to regenerate, and `bedrock deploy` publishes a
pre-built place in a single pass.

## Next

[`../ci-codegen`](../ci-codegen) takes the same project into CI: two
environments, a custom emitter that generates typed TypeScript instead of a Luau
table, and a GitHub Actions workflow that commits the regenerated ids back to
the branch.
