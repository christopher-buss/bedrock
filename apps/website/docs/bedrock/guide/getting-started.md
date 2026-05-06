# Getting Started

Bedrock is an Infrastructure-as-Code library for Roblox. You declare the
resources you want. Bedrock reconciles them against the live state through
[`@bedrock/ocale`](/ocale/guide/getting-started) and reports what changed.

This guide walks through the programmatic pipeline as of the first slice:
`config → buildDesired → diff → applyOps`. The `bedrock` CLI binary and
config-file loader come later; for now everything below is called from your
own TypeScript.

## Install

:::tabs key:pm
== pnpm
```sh
pnpm add bedrock
```
== npm
```sh
npm install bedrock
```
== bun
```sh
bun add bedrock
```
== yarn
```sh
yarn add bedrock
```
:::

## Declare your resources

Every managed resource has a user-chosen `key` that stays stable across
deploys. Bedrock correlates desired with current state by key, so renaming a
key is interpreted as a delete-and-create. Pick something durable.

```ts
import { asResourceKey } from "bedrock";

const resources = [
	{
		key: asResourceKey("vip-pass"),
		name: "VIP Pass",
		description: "Grants VIP perks.",
		iconFilePath: "assets/vip-icon.png",
		kind: "gamePass",
		price: 500,
	},
] as const;
```

Icon content is not declared inline. You point at a file path and Bedrock
hashes the file content in the next step so the diff can detect changes
without re-uploading unchanged assets.

## Build desired state

`buildDesired` is a shell function: it reads the icon files you declared,
computes a SHA-256 hash of each, and returns the fully-normalized
`ResourceDesiredState[]` that the pure core expects.

```ts
import { buildDesired } from "bedrock";
import { readFile } from "node:fs/promises";

const desired = await buildDesired({ resources }, (path) => readFile(path));
```

Injecting `readFile` keeps `buildDesired` testable against a fake filesystem,
and keeps the pure [`diff`](/bedrock/api/functions/diff) function free of I/O.

## Load current state

Current state is the snapshot of what Bedrock deployed last time: resource
keys paired with the outputs Roblox returned (asset IDs, icon asset IDs). The
Gist-backed state adapter ships in a later slice; until then, load current
state from wherever you persist it. On a first deploy the snapshot is empty:

```ts
import type { ResourceCurrentState } from "bedrock";

const current: ReadonlyArray<ResourceCurrentState> = [];
```

## Compute the diff

`diff` is pure and synchronous. It produces one [`Operation`](/bedrock/api/type-aliases/Operation)
per desired resource:

- `create` when the key is absent from current state.
- `update` when the key is present and a field drifted.
- `noop` when the key is present and every field matches.

```ts
import { diff } from "bedrock";

const ops = diff(desired, current);
```

A `delete` variant is deliberately absent in this slice: orphaned keys (in
current but not declared) are not reconciled until a future release
introduces explicit orphan handling.

## Apply the operations

Drivers are plugins that know how to materialize one resource kind against
its upstream API. A driver is an object conforming to the
[`ResourceDriver<K>`](/bedrock/api/interfaces/ResourceDriver) port. A
[`DriverRegistry`](/bedrock/api/type-aliases/DriverRegistry) is a
compile-time-checked dispatch table: every `ResourceKind` must map to a
driver or the registry fails to type-check.

```ts
import { GamePassesClient } from "@bedrock/ocale/game-passes";

import { applyOps, type DriverRegistry } from "bedrock";

const apiKey = process.env.BEDROCK_API_KEY;
if (apiKey === undefined) {
	throw new Error("BEDROCK_API_KEY is not set");
}

const client = new GamePassesClient({ apiKey });

const registry: DriverRegistry = {
	async gamePass(desired) {
		return client.create({
			/* ...map desired to the ocale request... */
		});
	},
};

const result = await applyOps(ops, registry);
```

`applyOps` stops on the first driver error and returns it in a `Result`. Any
ops that ran before the failure stay applied; this matches how Terraform and
Pulumi behave.

## Handle the result

Bedrock follows the same `Result` discipline as `@bedrock/ocale`: errors are
returned, not thrown. Narrow on `result.success` to reach either the new
current state or the error:

```ts
if (!result.success) {
	console.error(result.err.message);
	process.exit(1);
}
```

`result.err` is an [`OpenCloudError`](/ocale/guide/errors) re-exported from
`@bedrock/ocale`; see the ocale error guide for the hierarchy and
`instanceof` narrowing patterns.

## Reference

- [`diff`](/bedrock/api/functions/diff): pure reconciliation
- [`Operation`](/bedrock/api/type-aliases/Operation): discriminated union of reconciliation steps
- [`ResourceDesiredState`](/bedrock/api/type-aliases/ResourceDesiredState): what you declare
- [`ResourceCurrentState`](/bedrock/api/type-aliases/ResourceCurrentState): what Bedrock tracks
- [`ResourceDriver`](/bedrock/api/interfaces/ResourceDriver): the plugin contract
- [`DriverRegistry`](/bedrock/api/type-aliases/DriverRegistry): kind → driver dispatch table
- [`ResourceKey`](/bedrock/api/type-aliases/ResourceKey): branded primitive IDs

`buildDesired` and `applyOps` land in a follow-up along with the matching
API pages.
