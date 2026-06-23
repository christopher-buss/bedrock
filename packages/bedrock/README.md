# @bedrock-rbx/core

Infrastructure-as-Code for Roblox, with a bundled `bedrock` CLI.

[![npm version](https://img.shields.io/npm/v/@bedrock-rbx/core.svg)](https://npmx.dev/package/@bedrock-rbx/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/christopher-buss/bedrock/blob/main/LICENSE)
[![CI](https://github.com/christopher-buss/bedrock/actions/workflows/ci.yaml/badge.svg)](https://github.com/christopher-buss/bedrock/actions/workflows/ci.yaml)

> **Status: 0.1, pre-1.0.** The public API is stabilizing; breaking changes may land in minor releases until 1.0.

## What is `@bedrock-rbx/core`?

Bedrock defines a Roblox experience's setup, including the universe, places, game passes, and developer products, in a single config file you keep alongside your game code. Each deploy diffs that config against the live state in Roblox and applies the create or update operations needed to bring them into sync. Adding a new place (lobby, mini-game, hub world) means editing the config instead of clicking through Creator Hub.

It is a spiritual successor to [Mantle](https://github.com/blake-mealey/mantle) (no longer maintained), rebuilt on top of [Roblox Open Cloud](https://create.roblox.com/docs/cloud). That means API-key authentication only, no `ROBLOSECURITY` cookies or legacy endpoints.

Bedrock ships two paths to the same engine. The `bedrock` CLI reconciles a config file (TypeScript, JavaScript, YAML, JSON, or Luau) against live Roblox state. The programmatic API exposes the same `deploy()`, `diff()`, and `applyOps()` functions for direct use in TypeScript, so deploys can be triggered from a webhook handler, a chat bot, or any other service in your stack. Both surfaces run identical code below the entry point.

## Install

```bash
pnpm add -D @bedrock-rbx/core
# or: npm install --save-dev @bedrock-rbx/core
# or: bun add -d @bedrock-rbx/core
```

The `bedrock` binary is then available via your package manager (`pnpm bedrock`, `npx bedrock`, `bunx bedrock`).

**Runtime:** Node >= 24.12 or Bun >= 1.3.

**Authentication:** bedrock reads two environment variables.

| Variable | Purpose | Where to get it |
|---|---|---|
| `BEDROCK_API_KEY` | Authenticates Open Cloud calls. | [Creator Hub > Credentials > API Keys](https://create.roblox.com/dashboard/credentials). Needs the scopes for the resources you manage (universe-place, universe-place-config, universe-passes, universe-developer-products, asset-create). |
| `BEDROCK_GITHUB_TOKEN` | Reads and writes the state gist (the default state backend). | A GitHub personal access token with the `gist` scope. The gist itself starts empty: create one at [gist.github.com](https://gist.github.com), then put its ID in your config's `state.gistId`. |

Both can be overridden per environment in your config (or via `--api-key` / `--github-token` flags on the CLI).

## Quick start (programmatic)

A bedrock config is a plain `Config` object. The `defineConfig` helper is identity at runtime; it exists only to give TypeScript users full type inference and autocomplete.

```ts
// bedrock.config.ts
import { defineConfig } from "@bedrock-rbx/core/config";

export default defineConfig({
	environments: {
		production: {
			places: { "start-place": { placeId: "1234567890" } },
			universe: { universeId: "9876543210" },
		},
	},
	passes: {
		"vip-pass": {
			name: "VIP Pass",
			description: "Grants VIP perks.",
			icon: { "en-us": "assets/vip-icon.png" },
			price: 500,
		},
	},
	places: {
		"start-place": {
			displayName: "Start Place",
			filePath: "places/start.rbxl",
		},
	},
	state: { backend: "gist", gistId: "abc123def456" },
	universe: { voiceChatEnabled: true },
});
```

Place your custom deploy orchestration at `.bedrock/deploy.ts`. The `bedrock deploy` CLI auto-discovers and invokes this file when present, and the same exports can be imported from a webhook handler, chat bot, or other service that wants to trigger deploys directly.

```ts
// .bedrock/deploy.ts
import { deploy } from "@bedrock-rbx/core";

/**
 * Triggered from a webhook handler whenever a release tag is pushed.
 * Wraps `deploy` with custom orchestration: structured logging on
 * failure, success reporting back to the caller.
 *
 * @param environment - Target environment from the webhook payload.
 * @returns Whether the deploy completed successfully.
 */
export async function deployFromWebhook(environment: string): Promise<boolean> {
	const result = await deploy({ environment });
	if (!result.success) {
		console.error("bedrock deploy failed", { environment, err: result.err });
		return false;
	}

	console.log("bedrock deploy succeeded", { environment });
	return true;
}
```

`deploy()` returns a `Result<BedrockState, DeployError>` rather than throwing on failure. `Result` is a discriminated union: `result.success` is `true` with the value on `result.data`, or `false` with the error on `result.err`. `DeployError` is itself stage-tagged (`configLoadFailed`, `stateReadFailed`, `applyFailed`, and similar) so callers can branch on `kind` to distinguish what went wrong without parsing error messages.

## Quick start (CLI)

Using the same `bedrock.config.ts` from above:

```bash
export BEDROCK_API_KEY=...
export BEDROCK_GITHUB_TOKEN=...

pnpm bedrock deploy --env production
```

`bedrock deploy` discovers `bedrock.config.{ts,js,mjs,yaml,yml,json,luau}` in the current directory, loads it, and runs the same reconcile as the programmatic path. If no config sits at the project root, bedrock also looks inside `.bedrock/` so you can colocate the file with your other `.bedrock/` artifacts; a root-level config always wins on collision. Output is rendered via `@clack/prompts` (interactive progress, summary, and error reporting).

`--env` may be repeated to deploy to multiple environments in one invocation; each environment is reconciled with its own merged config and its own state slot.

## What bedrock manages today

| Kind | Key example | What bedrock manages | Notes |
|---|---|---|---|
| `universe` | `"main"` (singleton) | Display name, social links, per-device join toggles, voice chat, private-server price. | Adopted by ID. Bedrock does not create new universes. |
| `place` | `"start-place"` | Place metadata (display name, description, max players per server), `.rbxl` file uploads. | The root place is adopted; secondary places are provisioned by bedrock. |
| `gamePass` | `"vip-pass"` | Name, description, icon upload, price, on-sale state. | Provisioned by bedrock; the asset ID is recorded in outputs. |
| `developerProduct` | `"gem-pack-100"` | Name, description, icon upload, price. | Provisioned by bedrock; the asset ID is recorded in outputs. |

Bedrock does not delete resources. Removing an entry from your config leaves the upstream entity in place; delete it from Creator Hub directly if you want it gone. Additional kinds (badges, place settings, more) are on the [roadmap](https://github.com/christopher-buss/bedrock/projects).

## CLI reference

```text
bedrock <command> [options]
```

**`bedrock deploy`** - reconciles every configured environment (or only those passed via `--env`) against live Roblox state, writing the new state snapshot on success.

Options: `--env <name>` (repeatable), `--config <path>`, `--api-key <value>`, `--github-token <value>`.

**`bedrock diff`** - previews the operations a deploy *would* apply, without writing state or hitting any mutating Roblox endpoints. Suitable for code review and CI.

Options: same as `deploy`.

**`bedrock migrate [stateFilePath]`** - translates a state file from another deployment tool into a bedrock project. Currently supports Mantle (`--from mantle`); other sources will be added as needed. The maintainer-prompt UI walks through naming the project, choosing a backend, and resolving any unrecognized fields.

Options: `--from <tool>`.

Pass `--help` to any command for the full option list at the version you have installed.

## Programmatic API surface

The most commonly imported entry points:

| Symbol | Module | Role |
|---|---|---|
| `deploy()` | `@bedrock-rbx/core` | Full reconcile end-to-end. |
| `diff()` | `@bedrock-rbx/core` | Pure function from desired and current state to an operation list. |
| `applyOps()` | `@bedrock-rbx/core` | Dispatch an operation list to its drivers and collect outputs. |
| `loadConfig()` | `@bedrock-rbx/core` | Discover and load a `bedrock.config.*` file. |
| `buildDesired()` | `@bedrock-rbx/core` | Compute the desired-state list from a resolved config. |
| `defineConfig()` | `@bedrock-rbx/core/config` | Type-helper for `bedrock.config.ts`. |
| `ResourceDriver<K>` | `@bedrock-rbx/core` | Plugin contract for resource kinds. |
| `StatePort` | `@bedrock-rbx/core` | Plugin contract for state backends. |
| `ProgressPort` | `@bedrock-rbx/core` | Listener interface for per-resource and aggregate deploy events. |

`ResourceDriver<K>`, `StatePort`, and `ProgressPort` are published contracts today; the plugin runtime that lets you register custom implementations against a real deploy ships in v0.3.

See the [full reference on the docs site](https://bedrock-livid.vercel.app/) for the complete list of exports.

## Status, docs, and contributing

Bedrock is in active development ahead of a first public release. Track scope and timing on the [project board](https://github.com/christopher-buss/bedrock/projects).

- [Documentation site](https://bedrock-livid.vercel.app/) (work in progress)
- [Source repository](https://github.com/christopher-buss/bedrock)
- [Issues](https://github.com/christopher-buss/bedrock/issues) (maintainer-only; external feedback runs through [Discussions](https://github.com/christopher-buss/bedrock/discussions) as prompt requests)
- [Contributing guide](https://github.com/christopher-buss/bedrock/blob/main/CONTRIBUTING.md)
- [Security policy](https://github.com/christopher-buss/bedrock/blob/main/SECURITY.md)

## License

[MIT](https://github.com/christopher-buss/bedrock/blob/main/LICENSE) (c) Christopher Buss.
