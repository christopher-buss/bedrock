# Getting Started

## Install

:::tabs key:pm
== pnpm
```sh
pnpm add @bedrock-rbx/ocale
```
== npm
```sh
npm install @bedrock-rbx/ocale
```
== bun
```sh
bun add @bedrock-rbx/ocale
```
== yarn
```sh
yarn add @bedrock-rbx/ocale
```
:::

## Make a request

```ts
import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";

const apiKey = process.env.ROBLOX_API_KEY;
if (apiKey === undefined) {
	throw new Error("ROBLOX_API_KEY is not set");
}

const client = new GamePassesClient({ apiKey });

const result = await client.get({
	gamePassId: "9876543210",
	universeId: "1234567890",
});
```

## Handle the Result

Every client method returns `Result<T, OpenCloudError>`. Errors are returned,
not thrown:

```ts
if (!result.success) {
	console.error(result.err.message);
	return;
}

console.log(result.data.name);
```

See [Errors](/ocale/guide/errors) for the error hierarchy and
[Result](/ocale/api/index/type-aliases/Result) for the full type.
