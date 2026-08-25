# Minimal example

The smallest Bedrock project that still deploys and generates source: one config
file, one build override, and the built-in Luau emitter. Rojo builds the place;
no CI is involved.

Start here if you want to understand what Bedrock does before adding anything of
your own.

## What it shows

- Declaring a universe, a place, and a developer product in
  [`bedrock.config.ts`](bedrock.config.ts).
- Turning on codegen with no emitter code — the built-in emitter writes
  [`.bedrock/generated/resources.luau`](.bedrock/generated/resources.luau).
- Supplying the build step as a plain script at
  [`.bedrock/build.ts`](.bedrock/build.ts), which the CLI discovers by path.
- Reading a generated id from game code in
  [`src/server/init.server.luau`](src/server/init.server.luau).

## Layout

| Path                                | Role                                              |
| ----------------------------------- | ------------------------------------------------- |
| `bedrock.config.ts`                 | What should exist on Roblox.                      |
| `.bedrock/build.ts`                 | How to build the place. Discovered by the CLI.    |
| `.bedrock/generated/resources.luau` | Generated. Committed so game code can require it. |
| `default.project.json`              | Rojo project the build step compiles.             |
| `src/server/init.server.luau`       | Consumes a generated product id.                  |

## What a deploy does

`bedrock deploy --env production` runs five stages:

1. **Load and diff** — resolve the config for `production`, read the last
   deployed state from the gist, and compute the operations that close the gap.
2. **Provision** — create or update the universe and the developer product.
   Roblox assigns an id to anything created here.
3. **Codegen** — write `.bedrock/generated/resources.luau` from the state of
   every declared environment.
4. **Build** — spawn `.bedrock/build.ts`, which runs `rojo build` over the
   freshly regenerated source and leaves `build/place.rbxl`.
5. **Publish** — upload that artifact to the place and persist the new state.

Stages 3 and 4 are why the build is part of the deploy: a product created in
stage 2 has an id that did not exist when you last built, so the place must be
rebuilt before it is published. Bedrock checkpoints the provisioned ids to state
before the build runs, so a failed build never loses them.

Without `codegen.enabled`, stages 3 and 4 are skipped entirely and Bedrock
publishes the pre-built file in a single pass.

## Running it

Replace the placeholders in `bedrock.config.ts` first — `universeId`, `placeId`,
and `gistId` all point at nothing:

- `universeId` / `placeId`: an experience you own. Open Cloud cannot create
  either, so both must exist before the first deploy.
- `gistId`: a secret [GitHub Gist](https://gist.github.com) that holds the
  deployed state. Create an empty one and copy the id out of its URL.

Then set the two credentials and deploy:

```bash
export BEDROCK_API_KEY="<open-cloud-api-key>"
export BEDROCK_GITHUB_TOKEN="<github-token-with-gist-scope>"
```

```bash
pnpm bedrock diff --env production
```

`diff` prints the operations a deploy would apply and writes nothing. When it
looks right:

```bash
pnpm bedrock deploy --env production
```

## Next

[`../ci-codegen`](../ci-codegen) takes the same project into CI: two
environments, a custom emitter that generates typed TypeScript instead of a Luau
table, and a GitHub Actions workflow that commits the regenerated ids back to
the branch.
