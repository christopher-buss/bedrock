# Getting Started

Bedrock is an Infrastructure-as-Code tool for Roblox. You declare the resources
you want in a config file. Bedrock reconciles them against the live state
through [`@bedrock-rbx/ocale`](/ocale/guide/getting-started), applies the
difference, and persists what it deployed.

The fastest path is the `bedrock` CLI driven by a `bedrock.config.ts` file. The
same reconciliation is available programmatically through
[`deploy()`](/bedrock/api/functions/deploy), and the low-level pipeline that
`deploy()` is built from is exported too for advanced use.

## Install

:::tabs key:pm
== pnpm
```sh
pnpm add @bedrock-rbx/core
```
== npm
```sh
npm install @bedrock-rbx/core
```
== bun
```sh
bun add @bedrock-rbx/core
```
== yarn
```sh
yarn add @bedrock-rbx/core
```
:::

## Write a config

Create a `bedrock.config.ts` at your project root. Use
[`defineConfig`](/bedrock/api/functions/defineConfig) for full type inference;
it returns its argument unchanged, so it costs nothing at runtime.

```ts
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

What each block declares:

- **`passes`** — game passes, keyed by a stable user-chosen `ResourceKey`. Each
  entry carries a `name`, `description`, a locale-keyed `icon` (`"en-us"` path),
  and an optional `price` in Robux (omit for an off-sale pass). You point at an
  icon file; Bedrock hashes its contents so an unchanged icon is not re-uploaded.
- **`places`** — the root entry holds the bits every environment shares: a
  required `filePath` to the `.rbxl`/`.rbxlx` file, plus optional `displayName`,
  `description`, and `serverSize`. The Roblox `placeId` is *not* here — it is
  environment-specific.
- **`universe`** — the managed universe settings. `universeId` is a string of
  digits for an existing universe (Open Cloud cannot mint universes). Other
  managed fields include `voiceChatEnabled`, `displayName`, per-device join
  toggles (`consoleEnabled`, `mobileEnabled`, …), social links, and
  `privateServerPriceRobux`. Anything you omit stays unmanaged.
- **`environments`** — per-environment overlays, keyed by environment name. Each
  `places` overlay supplies that environment's `placeId` (the key must match a
  root `places` key); `filePath` falls through from the root entry.
- **`state`** — where Bedrock persists the deployed state. The Gist backend
  takes a `gistId`; the GitHub token is read from `BEDROCK_GITHUB_TOKEN`.

::: tip universeId placement
Declare `universeId` **either** on the root `universe` block (one universe for
every environment) **or** on each `environments[name].universe` overlay (a
distinct universe per environment) — never both. The schema rejects a config
that sets it in both places.
:::

Config files are discovered automatically as
`bedrock.config.{ts,js,mjs,yaml,yml,json,luau}` at the project root, or under a
`.bedrock/` directory if the root has none.

## Deploy from the CLI

Set the two credentials Bedrock reads from the environment, then deploy:

```sh
export BEDROCK_API_KEY="<open-cloud-api-key>"
export BEDROCK_GITHUB_TOKEN="<github-token-with-gist-scope>"

pnpm bedrock deploy --env production
```

`@bedrock-rbx/core` installs locally, so run its `bedrock` binary through your
package manager — `pnpm bedrock` (shown here), `npx bedrock`, or `bunx bedrock`.

To preview the operations a deploy *would* apply without writing any state, run
a dry run first:

```sh
pnpm bedrock diff --env production
```

`diff` prints the pending creates and updates per environment (or `No drift`
when everything matches). `--env` repeats for multiple environments, and
`--config` overrides config discovery. A `migrate` command is also available to
translate a Mantle state file into a Bedrock project.

## Deploy programmatically

[`deploy()`](/bedrock/api/functions/deploy) runs the same reconcile end-to-end.
Pass the target `environment`; every other dependency — config, state backend,
driver registry — is default-constructed from the discovered config and the
`BEDROCK_API_KEY` / `BEDROCK_GITHUB_TOKEN` environment variables.

```ts
import { deploy, getEnvironment } from "@bedrock-rbx/core";

import process from "node:process";

const environment = getEnvironment();
if (!environment.success) {
	console.error(environment.err);
	process.exit(1);
}

const result = await deploy({ environment: environment.data });

if (!result.success) {
	console.error(result.err);
	process.exit(1);
}
```

[`getEnvironment()`](/bedrock/api/functions/getEnvironment) resolves the target
from a `--env` flag or the `BEDROCK_ENVIRONMENT` variable, so the same script
works whether you invoke it directly or through the CLI's override mechanism.

`deploy()` returns `Promise<Result<BedrockState, DeployError>>`. Errors are
returned, not thrown — narrow on `result.success`. The
[`DeployError`](/bedrock/api/type-aliases/DeployError) is stage-tagged: branch
on `result.err.kind` (`configLoadFailed`, `stateReadFailed`, `applyFailed`, …)
to tell a missing config apart from a failed apply.

## Advanced: the low-level pipeline

`deploy()` is built from a pipeline of exported primitives:
`buildDesired → diff → applyOps`. Reach for them when you need to drive a stage
yourself — a custom orchestration, a bespoke state source, or a test harness.

### Build desired state

[`buildDesired`](/bedrock/api/functions/buildDesired) reads each file-backed
input, computes a SHA-256 hash of its contents, and returns the normalized
`ResourceDesiredState[]` the pure core consumes. Inject `readFile` so the step
stays testable against a fake filesystem:

```ts
import { buildDesired, flattenConfig, loadConfig, selectEnvironment } from "@bedrock-rbx/core";

import { readFile } from "node:fs/promises";

const config = await loadConfig();
if (!config.success) {
	throw new Error(config.err.kind);
}

const resolved = selectEnvironment(config.data, "production");
if (!resolved.success) {
	throw new Error(resolved.err.kind);
}

const desired = await buildDesired(flattenConfig(resolved.data), (path) => readFile(path));
if (!desired.success) {
	throw new Error(desired.err.kind);
}
```

[`loadConfig`](/bedrock/api/functions/loadConfig) discovers and validates the
`bedrock.config.*` file, `selectEnvironment` merges the chosen environment's
overlays onto the root config, and `flattenConfig` turns that resolved config
into the flat tagged input list `buildDesired` expects.

### Compute the diff

[`diff`](/bedrock/api/functions/diff) is pure and synchronous. It produces one
[`Operation`](/bedrock/api/type-aliases/Operation) per desired resource:

- `create` when the key is absent from current state.
- `update` when the key is present and a field drifted.
- `noop` when the key is present and every field matches.

```ts
import { diff, type ResourceCurrentState } from "@bedrock-rbx/core";

// Current state is the snapshot Bedrock deployed last time. On a first deploy
// it is empty; otherwise load it from your StatePort.
const current: ReadonlyArray<ResourceCurrentState> = [];

const ops = diff(desired.data, current);
```

### Build a driver registry

A [`DriverRegistry`](/bedrock/api/type-aliases/DriverRegistry) maps every
`ResourceKind` to a [`ResourceDriver`](/bedrock/api/interfaces/ResourceDriver) —
an *object* with a `create` method (and an optional `update`), not a bare
function. Build the default registry, which wires each kind to its
`@bedrock-rbx/ocale` client, with
[`buildDefaultRegistry`](/bedrock/api/functions/buildDefaultRegistry):

```ts
import { buildDefaultRegistry } from "@bedrock-rbx/core";

import { readFile } from "node:fs/promises";
import process from "node:process";

const registry = buildDefaultRegistry({
	config: resolved.data,
	getEnv: (name) => process.env[name],
	readFile: (path) => readFile(path),
});
if (!registry.success) {
	throw new Error(registry.err.kind);
}
```

It reads `BEDROCK_API_KEY` through the injected `getEnv` seam and
`config.universe.universeId`, returning a typed `missingCredential` or
`registryConfigMissing` error rather than throwing.

### Apply the operations

[`applyOps`](/bedrock/api/functions/applyOps) dispatches each non-noop op to its
driver and returns
`Result<ReadonlyArray<ResourceCurrentState>, AggregateApplyError>`. It is
continue-on-failure: every op is attempted regardless of earlier failures.

```ts
import { applyOps } from "@bedrock-rbx/core";

const result = await applyOps(ops, registry.data);
if (!result.success) {
	for (const failure of result.err.failures) {
		console.error(`${failure.key}: ${failure.kind}`);
	}

	process.exit(1);
}
```

On failure the error is an
[`AggregateApplyError`](/bedrock/api/interfaces/AggregateApplyError), not an
`OpenCloudError`: `result.err.applied` holds the survivors and
`result.err.failures` is a non-empty array of
[`ApplyError`](/bedrock/api/type-aliases/ApplyError), one per failing op, each
carrying a `key` and a cause. Iterate `failures` to report them.

## Reference

- [`deploy`](/bedrock/api/functions/deploy): high-level end-to-end reconcile
- [`defineConfig`](/bedrock/api/functions/defineConfig): typed config helper
- [`loadConfig`](/bedrock/api/functions/loadConfig): discover and validate config
- [`getEnvironment`](/bedrock/api/functions/getEnvironment): resolve the target environment
- [`diff`](/bedrock/api/functions/diff): pure reconciliation
- [`buildDesired`](/bedrock/api/functions/buildDesired): file-backed desired-state assembly
- [`buildDefaultRegistry`](/bedrock/api/functions/buildDefaultRegistry): default driver table
- [`applyOps`](/bedrock/api/functions/applyOps): dispatch operations to drivers
- [`Operation`](/bedrock/api/type-aliases/Operation): discriminated union of reconciliation steps
- [`ResourceDriver`](/bedrock/api/interfaces/ResourceDriver): the plugin contract
- [`DriverRegistry`](/bedrock/api/type-aliases/DriverRegistry): kind → driver dispatch table
- [`DeployError`](/bedrock/api/type-aliases/DeployError): stage-tagged deploy failure
- [`AggregateApplyError`](/bedrock/api/interfaces/AggregateApplyError): apply-stage failure batch
