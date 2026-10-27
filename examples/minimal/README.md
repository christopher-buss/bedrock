# Minimal example

This is the smallest Bedrock project that deploys and generates source. It's one
Luau config file and three commands, with no TypeScript, no override, and no CI.

## What it shows

- How to declare a universe, a place, and a developer product in
  [`bedrock.config.luau`](bedrock.config.luau).
- Type checking for that config. `defineConfig` from `@bedrock/config` flags a
  wrong field in your editor or in `lute check bedrock.config.luau`.
- Codegen without writing any emitter code. The built-in emitter writes
  [`.bedrock/generated/resources.luau`](.bedrock/generated/resources.luau) for
  you.
- How your game code reads a generated ID, in
  [`src/server/init.server.luau`](src/server/init.server.luau).
- How `universe.visibility = bedrock.privateVisibility` keeps this example
  private while deploying resources and publishing its place.

## Layout

| Path                                | Role                                              |
| ----------------------------------- | ------------------------------------------------- |
| `bedrock.config.luau`               | What should exist on Roblox.                      |
| `.config.luau`                      | Luau config. Maps the `@bedrock` alias.           |
| `.bedrock/config.luau`              | Written by `bedrock setup`. Config types.         |
| `.bedrock/setup-state.json`         | Written by `bedrock setup`. Records its choices.  |
| `.bedrock/generated/resources.luau` | Generated. Committed so game code can require it. |
| `default.project.json`              | Rojo project.                                     |
| `src/server/init.server.luau`       | Uses a generated product ID.                      |

Bedrock runs a `.luau` config with [lute](https://github.com/luau-lang/lute),
which this project's `mise.toml` installs for you. If you write your config in
TypeScript, JavaScript, YAML, or JSON instead, you don't need any extra tools.

`pnpm bedrock setup` wrote the types and added the `@bedrock` alias to
`.config.luau`. Rerun it after upgrading Bedrock. `pnpm bedrock setup --check`
fails if the committed types are out of date.

## Deploying it

First, replace the placeholders in `bedrock.config.luau`:

- `universeId` / `placeId`: point these at an experience you own. Open Cloud
  can't create either one, so both need to exist before your first deploy.
- `gistId`: a secret [GitHub Gist](https://gist.github.com) where Bedrock keeps
  its deployed state. Create an empty one and copy the ID from its URL.

Then set your two credentials:

```bash
export BEDROCK_API_KEY="<open-cloud-api-key>"
export BEDROCK_GITHUB_TOKEN="<github-token-with-gist-scope>"
```

Run `pnpm bedrock diff --env production` to see what a deploy would change. It
doesn't write anything. Once that looks right, run the three stages in order:

The example declares private visibility. Making an existing public experience
private removes its players. The API key needs `legacy-universe:manage` for
visibility writes and `universe:read` for ambiguous-timeout verification.

```bash
pnpm bedrock provision --env production
rojo build default.project.json --output place.rbxl
pnpm bedrock publish --env production
```

To make the experience public, change `visibility` to `"public"` before
provisioning. Provision defers activation until a successful matching publish;
publishing place content alone does not make the experience public. See
[visibility management](../../apps/website/docs/bedrock/guide/getting-started.md#manage-experience-visibility)
for omission, environment inheritance, and recovery.

## Why three commands

`provision` adopts the universe you declared and creates anything Open Cloud can
create, which here is the developer product. That means Roblox hands out IDs
that didn't exist the last time you built. Bedrock then regenerates
`resources.luau` with those IDs. Your place has to be rebuilt with the new file
before it's published, which is why `rojo build` sits between the two Bedrock
commands. Bedrock saves the new IDs to state before the build runs, so if the
build fails, you don't lose them.

`bedrock deploy` does all three in one go, but it can only run the build itself
if you give it a build step. That's a `.bedrock/build.ts` override, which
[`../ci-codegen`](../ci-codegen) has and this example doesn't. If codegen is
turned off, there's nothing to regenerate, and `bedrock deploy` publishes a
pre-built place in a single pass.

## Next

[`../ci-codegen`](../ci-codegen) takes the same project into CI. It adds a
second environment, a custom emitter that generates typed TypeScript instead of
a Luau table, and a GitHub Actions workflow that commits the regenerated IDs
back to your branch.
