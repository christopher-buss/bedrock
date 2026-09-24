<h1 align="center">Bedrock</h1>

<div align="center">

[![npm](https://raw.githubusercontent.com/maneetoo/Roblox-OSS-Badges/5959dc76990e4dc70d697f8b39db48da5a282837/Badges/Community/Package/link-npm.svg)](https://npmx.dev/package/@bedrock-rbx/core)
[![Roblox OSS Discord](https://raw.githubusercontent.com/maneetoo/Roblox-OSS-Badges/5f7377f6de78a403fb2d49a34fc67d685f8eda3d/Badges/Community/Discord/link-discord-roblox-oss.svg)](https://discord.com/channels/385151591524597761/1552812767277228082)
[![Sponsor me](https://raw.githubusercontent.com/maneetoo/Roblox-OSS-Badges/b880ff3b8ca27e95914b12adcb784e29ef5c7222/Badges/Roblox-Styled/Original/sponsor-me-var2.svg)](https://github.com/sponsors/christopher-buss)
[![Rokit](https://raw.githubusercontent.com/maneetoo/Roblox-OSS-Badges/5959dc76990e4dc70d697f8b39db48da5a282837/Badges/Community/Package/rokit.svg)](#install-bedrock)

[![CI](https://github.com/christopher-buss/bedrock/actions/workflows/ci.yaml/badge.svg)](https://github.com/christopher-buss/bedrock/actions/workflows/ci.yaml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

</div>

Bedrock is an Infrastructure as Code (IaC) tool for Roblox. You describe your
experience in a config file, and Bedrock deploys it for you. You can run it from
the command line, or use it as a TypeScript library in your own tooling.

> **Pre-release.** Bedrock is still in active development and hasn't reached 1.0
> yet, so breaking changes may land in minor releases until then. Watch the
> repository or the
> [project board](https://github.com/christopher-buss/bedrock/projects) to
> follow progress.

## What Bedrock does

Bedrock manages your experience's resources, such as your universe, game passes,
and more, from a config file beside your game code. This approach is called
Infrastructure as Code. The config file describes what your experience should
have, and Bedrock updates Roblox to match it.

For example, if you declare a "100 Coins" developer product priced at 49 Robux,
the first `bedrock deploy` creates it on Roblox and saves its product ID.
Changing the price to 59 Robux causes the next deploy to update that same
product instead of creating a second one. Run `bedrock diff` first to see what a
deploy would change.

With codegen turned on, Bedrock also writes that product ID into a Luau module.
Your scripts `require` the module, so you don't have to copy IDs into game code
by hand. If you have separate staging and production experiences, one config can
deploy to both, and each one gets its own IDs.

Bedrock is a spiritual successor to
[Mantle](https://github.com/blake-mealey/mantle) (no longer maintained), rebuilt
on [Roblox Open Cloud](https://create.roblox.com/docs/cloud).

> Bedrock can't create universes or places, because Open Cloud can't either.
> Both need to exist before your first deploy. Bedrock also won't remove
> anything from Roblox. If you delete a resource from your config, it stays
> where it is.

## Why Bedrock

- **Open Cloud API keys.** Bedrock signs in with Open Cloud API keys. It never
  touches your `ROBLOSECURITY` cookie or Roblox's legacy endpoints.
- **CLI or library.** Use the CLI for everyday deploys, or call `deploy()`,
  `diff()`, and `applyOps()` from TypeScript when you want more control.
- **No server to host.** Bedrock keeps its state, the record of what it has
  deployed, in a GitHub Gist by default. If you'd rather use AWS S3 or an
  S3-compatible store, there's an optional plugin for that.
- **Config in the language you already use.** Write it in TypeScript,
  JavaScript, YAML, JSON, or Luau.

## Packages

You only need `@bedrock-rbx/core` to deploy. The rest are optional:

| Package                                        | What it's for                                                  |
| ---------------------------------------------- | -------------------------------------------------------------- |
| [`@bedrock-rbx/core`](./packages/bedrock)      | The deployment library and the `bedrock` CLI.                  |
| [`@bedrock-rbx/ocale`](./packages/open-cloud)  | A typed Roblox Open Cloud client. You can use it on its own.   |
| [`@bedrock-rbx/state-s3`](./packages/state-s3) | Keeps state in S3 or an S3-compatible store instead of a Gist. |
| [Bedrock GitHub Actions](./packages/actions)   | Deploys from CI and commits generated IDs back to your branch. |

## What works today

Right now, Bedrock can:

- Manage universes, places, game passes, and developer products from your
  config.
- Generate source files with the IDs Roblox assigns, for your game code to
  `require`.
- Run `deploy`, `diff`, `build`, `provision`, `publish`, `state`, and `migrate`
  from the CLI, or the same deployment steps from TypeScript.
- Store state in a GitHub Gist or an S3-compatible store.

Under the hood, `@bedrock-rbx/ocale` talks to Open Cloud for Bedrock, with rate
limiting and retries built in. It covers universes, places, game passes,
developer products, badges, storage, locales, server restarts, and Luau
execution.

## Install Bedrock

Bedrock needs Node.js 24.12 or later, or Bun 1.3 or later. If you write your
config in Luau, you'll also need [lute](https://github.com/luau-lang/lute) on
your `PATH`.

### With mise

If your project doesn't have a `package.json`, which is common for Luau
projects, [mise](https://mise.jdx.dev) is the easiest way in. It installs Node
and Bedrock for you, per project. Add this to your `mise.toml`:

```toml
[tools]
node = "lts"
"npm:@bedrock-rbx/core" = { version = "latest", allow_low_downloads = true }
"github:luau-lang/lute" = "1.0.0" # only needed for Luau configs
```

Then run `mise install`. If mise is
[activated](https://mise.jdx.dev/getting-started.html#activate-mise) in your
shell, `bedrock` is now on your `PATH`. If not, run it with
`mise exec -- bedrock`.

### With a package manager

If your project already uses npm, pnpm, or Bun, add Bedrock as a development
dependency:

```bash
pnpm add -D @bedrock-rbx/core
# or: npm install --save-dev @bedrock-rbx/core
# or: bun add -d @bedrock-rbx/core
```

Then run the CLI through your package manager: `pnpm bedrock`, `npx bedrock`, or
`bunx bedrock`.

### With Rokit

[Rokit](https://github.com/rojo-rbx/rokit) installs a standalone `bedrock`
binary, which needs no JavaScript runtime:

```bash
rokit add christopher-buss/bedrock
```

A config that imports a package, such as a plugin listed under `plugins`, needs
that package installed in the project's `node_modules`.

### Next steps

The best place to start is the [`examples`](./examples/) directory. Each example
has a README that walks you through setup, credentials, and deploying:

- [`minimal`](./examples/minimal/) is a Luau config you deploy by hand, with
  `provision`, a Rojo build, and then `publish`.
- [`ci-codegen`](./examples/ci-codegen/) deploys from GitHub Actions and commits
  the generated asset IDs back to your branch.

## Contributing

Bedrock is a solo project with an inverted contribution model. For anything
substantial, start a
[Discussion](https://github.com/christopher-buss/bedrock/discussions) as a
**prompt request**: share the prompt you would run, and if it fits the project,
I'll run it. Small or mechanical fixes can go straight to a normal pull request.
Please don't open issues directly. I create them from Discussions once the work
is ready to start.

To build and test everything locally:

```bash
git clone https://github.com/christopher-buss/bedrock.git
cd bedrock
pnpm install
pnpm build
pnpm test
```

The repo uses [pnpm](https://pnpm.io) workspaces and [Bun](https://bun.sh) 1.3
or later, and Vite+ runs the builds, tests, and tasks. CI expects 100% test
coverage, so any change needs tests that cover it.

Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before you open a discussion or
pull request. By taking part, you agree to follow the
[Code of Conduct](./CODE_OF_CONDUCT.md). If you find a security vulnerability,
report it as described in [SECURITY.md](./SECURITY.md), not in a public issue or
discussion.

## License

[MIT](./LICENSE) (c) Christopher Buss.
