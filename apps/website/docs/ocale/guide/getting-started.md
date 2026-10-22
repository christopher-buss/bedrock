# Getting Started

## Install

:::tabs key:pm == pnpm

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

const client = new GamePassesClient({ credential: { apiKey, kind: "apiKey" } });

const result = await client.get({
	gamePassId: "9876543210",
	universeId: "1234567890",
});
```

### With OAuth

Pass an OAuth credential instead. `identity` names the grant (for example the
Roblox user id) and must not change when the token rotates.
`createOAuthTokenRefresher` keeps the access token fresh from a refresh token:

```ts
import { createOAuthTokenRefresher } from "@bedrock-rbx/ocale";
import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";

const client = new GamePassesClient({
	credential: {
		getAccessToken: createOAuthTokenRefresher({
			clientId: "your-client-id",
			clientSecret: "your-client-secret",
			onRotate: async (refreshToken) => saveRefreshToken(refreshToken),
			refreshToken: loadRefreshToken(),
		}),
		identity: "123456",
		kind: "oauth",
	},
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
