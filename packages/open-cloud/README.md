# @bedrock-rbx/ocale

Zero-dependency TypeScript SDK for Roblox Open Cloud.

[![npm version](https://img.shields.io/npm/v/@bedrock-rbx/ocale.svg)](https://npmx.dev/package/@bedrock-rbx/ocale)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/christopher-buss/bedrock/blob/main/LICENSE)
[![CI](https://github.com/christopher-buss/bedrock/actions/workflows/ci.yaml/badge.svg)](https://github.com/christopher-buss/bedrock/actions/workflows/ci.yaml)

> **Status: 0.1 beta.** The public API is stabilizing. Breaking changes may land in minor releases (0.1 to 0.2) until 1.0.

## What is `@bedrock-rbx/ocale`?

A typed HTTP client for [Roblox Open Cloud](https://create.roblox.com/docs/cloud). Each Roblox feature (universes, places, game passes, developer products, badges, storage, Luau execution) is exposed as its own client class with the methods, request types, and response types you would otherwise build by hand against the raw REST endpoints.

The SDK has zero runtime dependencies and runs on Node >= 24.12 or Bun >= 1.3 using the standard `fetch`, `FormData`, and `TextEncoder` web APIs. Rate-limit queueing and retry handling are built in: requests are queued per-operation against Roblox's published limits, and idempotent calls automatically retry on 429 and 5xx responses without consumer code reaching for `try`/`catch` or `setTimeout`.

`@bedrock-rbx/ocale` is the foundation that [`@bedrock-rbx/core`](https://github.com/christopher-buss/bedrock/tree/main/packages/bedrock) uses internally to talk to Roblox, and it is publishable as a standalone package for anyone building tooling, scripts, or services that need typed Open Cloud calls without bedrock's full IaC engine. If you already depend on `@bedrock-rbx/core`, ocale is installed transitively; reach for it directly when you need HTTP-level control that core's IaC engine does not expose.

## Install

```bash
pnpm add @bedrock-rbx/ocale
# or: npm install @bedrock-rbx/ocale
# or: bun add @bedrock-rbx/ocale
```

**Runtime:** Node >= 24.12 or Bun >= 1.3.

**Authentication:** every client takes an `apiKey` at construction. Generate one at [Creator Hub > Credentials > API Keys](https://create.roblox.com/dashboard/credentials) and grant it the scopes for the operations you plan to call (each method's JSDoc lists its required scopes).

## Quick start

```ts
import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";

const client = new GamePassesClient({ apiKey: "your-open-cloud-api-key" });

const result = await client.get({
	gamePassId: "9876543210",
	universeId: "1234567890", // from your experience URL in Creator Hub
});

if (!result.success) {
	console.error(`Open Cloud call failed: ${result.err.message}`);
	process.exit(1);
}

console.log(`${result.data.name}: ${result.data.priceInRobux} Robux`);
```

Every method returns `Promise<Result<T, OpenCloudError>>`. `Result` is a discriminated union: `result.success` is `true` with the parsed response on `result.data`, or `false` with a structured error on `result.err`. No exception ever escapes a client method.

## Available clients

Resource clients live on subpaths so unused features tree-shake out of your bundle.

| Subpath | Client | What it covers |
|---|---|---|
| `@bedrock-rbx/ocale/universes` | `UniversesClient` | Universe metadata, social links, icon and thumbnail uploads, badges and game-passes scoped to a universe. |
| `@bedrock-rbx/ocale/places` | `PlacesClient` | Place metadata, `.rbxl` publishing, Luau execution tasks scoped to a place. |
| `@bedrock-rbx/ocale/game-passes` | `GamePassesClient` | Game pass CRUD, icon upload, localized name and description updates. |
| `@bedrock-rbx/ocale/developer-products` | `DeveloperProductsClient` | Developer product CRUD, icon upload, localized name and description updates. |
| `@bedrock-rbx/ocale/badges` | `BadgesClient` | Badge CRUD and localized icon uploads. |
| `@bedrock-rbx/ocale/storage` | `StorageClient` | Memory stores (sorted maps, queues) for live game state. |
| `@bedrock-rbx/ocale/luau-execution` | `LuauExecutionClient` | Standalone Luau execution tasks with binary inputs and log streaming. |
| `@bedrock-rbx/ocale/locales` | `ROBLOX_CREATOR_LOCALES` (data) | Reference list of locales Roblox supports for localized fields. |

Additional Open Cloud features (messaging, data stores, OAuth, groups, analytics) are not yet wrapped; they are tracked on the [roadmap](https://github.com/christopher-buss/bedrock/projects).

The package root (`@bedrock-rbx/ocale`) deliberately re-exports only shared utilities: `Result`, `Page`, `OpenCloudError` and its subclasses (`ApiError`, `RateLimitError`, `NetworkError`, `ValidationError`, and similar), and the `OpenCloudClientOptions` type. Resource clients are not on the root barrel.

## Rate limiting and retries

The SDK queues every request behind a per-operation rate-limit bucket sourced from Roblox's published OpenAPI schema. You fire calls at whatever rate your code needs; the SDK paces them.

Retry behavior is idempotency-aware:

| Method kind | 429 (rate limit) | 5xx (server error) |
|---|---|---|
| Create | Retry | Do not retry |
| Read / List | Retry | Retry |
| Update | Retry | Retry |
| Delete | Retry | Retry |

Create operations skip 5xx retries because Roblox does not support idempotency keys and a duplicate retry would silently produce a second resource. If you can detect duplicates externally, opt back into 5xx retry on a per-call basis via `retryableStatuses` on the request options argument.

After retry attempts are exhausted, the final failure surfaces on `result.err` as the typed error that caused it (`RateLimitError` for 429s, `ApiError` for 5xx, `NetworkError` for transport-level faults, and so on).

Observability hooks (`onRequest`, `onRetry`, `onRateLimit`) accept callbacks on the client constructor for logging, metrics, or tracing integration.

## Per-request configuration overrides

Client-level config is frozen on construction. Every method accepts an optional second `RequestOptions` argument that overrides config for a single call:

```ts
const client = new GamePassesClient({ apiKey: "main-key" });

const result = await client.create(parameters, {
	apiKey: "asset-upload-key", // different key for moderation safety
	timeout: 60_000,
});
```

This pattern fits multi-tenant tooling (different API keys per workspace), credential rotation (swap mid-batch), and isolating retry / timeout policies to specific calls.

## Testing helpers

A `@bedrock-rbx/ocale/testing` subpath exports the same fakes the SDK's own integration tests use:

- `createFakeHttpClient(...)` and `createFakeSend(...)` for swapping the HTTP transport with a recorded fake that validates request bodies against the vendored OpenAPI schema.
- `createFakeSleep(...)` for deterministic retry and rate-limit timing.
- `valid*Body` fixtures (`validGamePassBody`, `validPlaceBody`, `validUniverseBody`, and similar) for synthesising realistic response payloads.

Pass the fake into any client via the `httpClient` and `sleep` parameters on `OpenCloudClientOptions` and assert against the captured requests.

## Status, docs, and contributing

This package is in active development ahead of a first public release. Track scope and timing on the [project board](https://github.com/christopher-buss/bedrock/projects).

- [Documentation site](https://bedrock-livid.vercel.app/) (work in progress)
- [Source repository](https://github.com/christopher-buss/bedrock/tree/main/packages/open-cloud)
- [Issues](https://github.com/christopher-buss/bedrock/issues) (maintainer-only; external feedback runs through [Discussions](https://github.com/christopher-buss/bedrock/discussions) as prompt requests)
- [Contributing guide](https://github.com/christopher-buss/bedrock/blob/main/CONTRIBUTING.md)
- [Security policy](https://github.com/christopher-buss/bedrock/blob/main/SECURITY.md)

## License

[MIT](https://github.com/christopher-buss/bedrock/blob/main/LICENSE) (c) Christopher Buss.
