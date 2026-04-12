# Open Cloud Package Design Document

**Date:** 2025-12-13 **Status:** Design Phase **Package:** `@bedrock/open-cloud`

## Executive Summary

This document outlines the design for `@bedrock/open-cloud`, a standalone
TypeScript HTTP client for Roblox Open Cloud APIs. The package provides
type-safe, functional access to ~12 Open Cloud service categories with optimal
tree-shaking, Result-based error handling, and per-request configuration
overrides.

**Key Design Decisions:**

- Single package with subpath exports (bundle optimization)
- Class-based clients with immutable config (encapsulation + ergonomics)
- Result types over exceptions (functional, explicit error handling)
- Stainless-style per-request overrides (multi-key support)
- Simplified architecture (pure builders/parsers, no FCIS terminology)

## Goals

1. **Standalone & Publishable**: Usable independently of Bedrock CLI
2. **Bundle Optimized**: Subpath exports enable optimal tree-shaking
3. **Type-Safe**: Full TypeScript coverage with exported types
4. **Testable**: 100% coverage, pure functions tested without mocks
5. **Zero Dependencies**: Lightweight, secure, fast installation
6. **Developer-Friendly**: Intuitive API inspired by Stainless-generated SDKs

## Research Findings

### Roblox Open Cloud Structure

Research reveals **~12 major service categories** (not 800 individual
endpoints):

1. Data and memory stores
2. Luau execution
3. Monetization (creator store, subscriptions)
4. Universes and places
5. Users and groups
6. Game passes
7. Developer products
8. Badges
9. Asset delivery and permissions
10. Game internationalization
11. Publish
12. Game icons and thumbnails

**Implication:** Modest API surface makes subpath exports practical without
package explosion.

### Industry SDK Patterns

**AWS SDK v3:**

- Separate packages per service (`@aws-sdk/client-dynamodb`)
- Client instances with per-request overrides
- Tree-shaking via modular packages

**OpenAI SDK (Stainless-generated):**

- Single package, client instance pattern
- Per-request config override via optional second parameter
- TypeScript-first with strong type safety

**Our approach:** Combine both patterns - single package with subpath exports +
Stainless-style client pattern.

## Scope for v0.1

### Supported APIs

| Feature                | API Status      | Operations                                   |
| ---------------------- | --------------- | -------------------------------------------- |
| **Game Passes**        | ✅ Full Support | Create, Read, Update, List                   |
| **Developer Products** | ✅ Full Support | Create, Read, Update, List                   |
| **Game Icons**         | ✅ Full Support | Upload, Delete                               |
| **Game Thumbnails**    | ✅ Full Support | Upload, Delete, Reorder, Alt Text, Get Media |
| **Universes**          | ✅ Full Support | Read, Update (title, settings)               |

### Out of Scope for v0.1

- Avatar settings (Studio-only, no programmatic API)
- Advanced localization (auto-translate, bulk operations)
- Additional services (groups, users, data stores)
- OAuth 2.0 support (API keys only for v0.1)

## Architecture

### Package Structure

```text
packages/open-cloud/
├── src/
│   ├── resources/                    # Service clients (public API)
│   │   ├── game-passes/
│   │   │   ├── index.ts              # GamePassesClient class
│   │   │   ├── types.ts              # Public types
│   │   │   ├── builders.ts           # Pure: request builders
│   │   │   └── parsers.ts            # Pure: response parsers
│   │   ├── developer-products/
│   │   ├── game-icons/
│   │   ├── game-thumbnails/
│   │   └── universes/
│   │
│   ├── internal/                     # Internal utilities (not exported)
│   │   ├── http/
│   │   │   ├── fetch-client.ts       # HTTP implementation
│   │   │   ├── rate-limit-queue.ts   # Rate limiting & queuing
│   │   │   ├── multipart.ts          # Multipart encoding
│   │   │   └── types.ts              # HttpRequest, HttpResponse
│   │   └── utils/
│   │       └── try-catch.ts          # tryCatch helper
│   │
│   ├── errors/                       # Error classes (exported)
│   │   ├── base.ts                   # OpenCloudError
│   │   ├── rate-limit.ts             # RateLimitError
│   │   ├── api-error.ts              # ApiError
│   │   ├── network-error.ts          # NetworkError
│   │   └── validation-error.ts       # ValidationError
│   │
│   ├── client/                       # Shared client types
│   │   └── types.ts                  # OpenCloudClientOptions, RequestOptions
│   │
│   ├── types.ts                      # Shared types (Result, etc.)
│   └── index.ts                      # Root export (errors + shared types only)
│
└── tests/
    ├── helpers/                      # Test utilities
    │   └── fake-http-client.ts       # Fake HTTP client for testing
    │
    ├── unit/                         # Pure function tests
    │   └── resources/
    │       └── game-passes/
    │           ├── builders.spec.ts
    │           └── parsers.spec.ts
    │
    └── integration/                  # Client tests with fake HTTP
        └── resources/
            └── game-passes/
                └── client.spec.ts
```

### Architecture Principles

**Why NOT strict FCIS?**

ADR-002 prescribes FCIS for the **Bedrock CLI** (the application with business
logic). The Open Cloud SDK is an **HTTP client library** - it IS the I/O layer
for Bedrock. Forcing "Ports and Adapters" terminology on a simple HTTP wrapper
adds unnecessary complexity.

**What we keep from functional principles:**

- ✅ Pure builders (testable request construction)
- ✅ Pure parsers (testable response parsing)
- ✅ Separation of concerns (public vs internal)
- ✅ Result types (explicit error handling)
- ✅ Immutable config (no hidden state)

**What we simplify:**

- ❌ No "Core/Shell" terminology (confusing for libraries)
- ❌ No "Ports" (HTTP isn't swappable - it's the contract)
- ❌ No "Adapters" (just call it "HTTP implementation")

## API Design

### Client Pattern

**Class-based clients with immutable config:**

```typescript
export class GamePassesClient {
	private readonly config: OpenCloudConfig;
	private readonly http: HttpClient;

	constructor(options: OpenCloudClientOptions) {
		this.config = Object.freeze({ ...options });
		this.http = options.httpClient ?? createHttpClient();
	}

	public async create(
		parameters: CreateGamePassParams,
		options?: RequestOptions,
	): Promise<Result<GamePass, OpenCloudError>> {
		const request = buildCreateRequest(parameters); // Pure function
		const result = await this.http.request(request, {
			...this.config,
			...options, // Per-request override
		});

		if (!result.success) {
			return result;
		}

		const gamePass = parseGamePassResponse(result.data.body); // Pure function
		return { data: gamePass, success: true };
	}
}
```

### Per-Request Configuration Override

**Inspired by Stainless-generated SDKs:**

```typescript
const client = new GamePassesClient({ apiKey: "main-key" });

// Normal usage (uses main-key)
const result = await client.create({
	name: "VIP Pass",
	priceInRobux: 100,
	universeId: "123",
});

// Override for asset uploads (different account for moderation safety)
const resultWithIcon = await client.create(
	{
		name: "VIP Pass",
		iconFile: imageData,
		priceInRobux: 100,
		universeId: "123",
	},
	{
		apiKey: "asset-upload-key", // Override API key for this request
		timeout: 60000, // Override timeout
	},
);
```

**Use case:** Bedrock users can use separate API keys for asset uploads to
mitigate content moderation account bans.

### Result Types (No Exceptions)

**Aligned with functional skill principles:**

```typescript
export type Result<T, E = Error> = { data: T; success: true } | { err: E; success: false };

// All client methods return Promise<Result<T, OpenCloudError>>
const result = await client.create(params);

if (!result.success) {
	if (result.err instanceof RateLimitError) {
		await sleep(result.err.retryAfterSeconds * 1000);
		// retry...
	} else {
		console.error("Failed:", result.err.message);
	}

	return;
}

console.log("Success:", result.data.id);
```

**Why Result over exceptions:**

- Explicit error handling (visible in type system)
- No hidden control flow
- Aligns with functional programming principles
- TypeScript narrows types correctly

## Type System

### Principles

1. **TypeScript-first**: camelCase (not snake_case like Roblox API)
2. **Strict types**: No `any`, prefer `unknown` for untyped data
3. **Readonly responses**: All response types immutable
4. **Export everything**: All public types exported for consumers

### Example Types

```typescript
// Request types
export interface CreateGamePassParameters {
	name: string;
	description?: string;
	iconFile?: Uint8Array;
	priceInRobux: number;
	universeId: string;
}

// Response types (readonly)
export interface GamePass {
	readonly id: string;
	readonly name: string;
	readonly createdTimestamp: string;
	readonly description?: string;
	readonly iconImageId?: string;
	readonly path: string;
	readonly priceInRobux: number;
	readonly updatedTimestamp: string;
}

export interface OpenCloudClientOptions {
	apiKey: string;
	baseUrl?: string;
	// Testing
	httpClient?: HttpClient; // Inject fake HTTP client for tests

	// Retry configuration
	maxRetries?: number; // Default: 3
	onRateLimit?: (waitMs: number) => void;
	// Observability hooks
	onRequest?: (request: HttpRequest) => void;

	onRetry?: (attempt: number, error: OpenCloudError) => void;
	retryableStatuses?: Array<number>; // Default: [429, 500, 502, 503, 504]
	retryDelay?: (attempt: number) => number; // Exponential backoff

	timeout?: number;
}

// Pagination
export interface PaginatedResponse<T> {
	readonly items: ReadonlyArray<T>;
	readonly nextPageToken?: string;
}

export interface RequestOptions {
	apiKey?: string;
	baseUrl?: string;
	maxRetries?: number;
	timeout?: number;
}
```

## Edge Case Handling

This section documents expected SDK behavior for edge cases that may occur
during normal operation.

### File Upload Edge Cases

| Scenario                 | Behavior                                           |
| ------------------------ | -------------------------------------------------- |
| Empty file (0 bytes)     | Allow (API may reject, return ApiError)            |
| Oversized file           | Client-side validation (return ValidationError)    |
| Invalid MIME type        | Allow (API validates, return ApiError if rejected) |
| Unicode in filename      | Encode properly in multipart Content-Disposition   |
| Missing filename         | Generate default: `upload-{timestamp}.bin`         |
| Null/undefined file data | Return ValidationError before making request       |

**Implementation notes:**

- Max file size limits per API must be researched and enforced client-side
- Use `TextEncoder` for proper filename encoding in multipart headers
- Validation happens in builders (pure functions return Result types)

### Pagination Edge Cases

| Scenario                  | Behavior                                          |
| ------------------------- | ------------------------------------------------- |
| Empty result set          | Return `{ items: [], nextPageToken: undefined }`  |
| Invalid nextPageToken     | Pass to API, return ApiError if rejected          |
| Expired nextPageToken     | API returns error, client propagates as ApiError  |
| Missing maxPageSize       | Use API default (typically 100)                   |
| maxPageSize out of bounds | Client validates against API limits, return error |

### Rate Limit Edge Cases

| Scenario                       | Behavior                                    |
| ------------------------------ | ------------------------------------------- |
| Multiple clients, same API key | Each client maintains own queue (duplicate) |
| Very large queue (>1000 items) | No limit, continue queuing (memory warning) |
| Queue during client disposal   | Pending requests complete, new rejected     |
| Concurrent key override        | Each key gets separate queue lazily         |

**Implementation notes:**

- Document that multiple client instances with same API key won't share quotas
- Consider adding queue size metrics to observability hooks in future

### Network & Timeout Edge Cases

| Scenario                  | Behavior                                         |
| ------------------------- | ------------------------------------------------ |
| Request timeout           | Return NetworkError after configured timeout     |
| Timeout during retry      | Each retry attempt gets full timeout window      |
| DNS resolution failure    | Return NetworkError with cause                   |
| Connection refused        | Return NetworkError with cause                   |
| Response body parse error | Return ApiError "Failed to parse response"       |
| Partial response received | Depends on fetch() behavior, likely NetworkError |

### API Key Edge Cases

| Scenario                | Behavior                                   |
| ----------------------- | ------------------------------------------ |
| Empty string API key    | Allow (API will reject with 401/403)       |
| Malformed API key       | Allow (API validates format)               |
| Expired API key         | API returns 401/403, propagate as ApiError |
| Key without permissions | API returns 403, propagate as ApiError     |
| Key for wrong universe  | API returns 403/404, propagate as ApiError |

**Rationale:** Client-side key validation is fragile and can break when Roblox
changes key formats. Let the API be the source of truth.

## Rate Limiting & Retry Strategy

### Design Philosophy

**SDK manages concurrency, not the CLI.** Bedrock can fire all requests at
once - the SDK queues and rate-limits them internally. This prevents the CLI
from needing to coordinate retries with its own queue.

### Example Usage

```typescript
const client = new GamePassesClient({
	apiKey: "key",
	maxRetries: 3,

	onRateLimit: (waitMs) => console.log(`[RATE LIMIT] Waiting ${waitMs}ms...`),
	// Observability hooks (optional)
	// eslint-disable-next-line arrow-style/arrow-return-style -- False positive
	onRequest: (request) => {
		return console.log(`[REQUEST] ${request.method} ${request.url}`);
	},
	onRetry: (attempt, error) => console.log(`[RETRY ${attempt}] ${error.message}`),
});

// Bedrock fires all 10 requests - SDK queues internally
// Rate limits are built-in (no configuration needed)
const results = await Promise.all([
	client.create({ name: "Pass 1", priceInRobux: 100, universeId: "123" }),
	client.create({ name: "Pass 2", priceInRobux: 100, universeId: "123" }),
	// ... 10 total
]);
```

**Note:** Rate limits are built into each client based on Roblox's documented
API limits. Users don't configure them - the SDK knows the correct limits per
API.

### Internal Implementation

```typescript
// Rate limits per API (from Roblox documentation)
const GAME_PASSES_RATE_LIMIT = {
	requestsPerMinute: 60,
	requestsPerSecond: 10,
};

class GamePassesClient {
	private readonly config: OpenCloudConfig;
	private readonly queues: Map<string, RateLimitQueue>;

	constructor(options: OpenCloudClientOptions) {
		this.config = Object.freeze({ ...options });
		this.queues = new Map();
	}

	public async create(
		parameters: CreateGamePassParams,
		options?: RequestOptions,
	): Promise<Result<GamePass, OpenCloudError>> {
		const mergedConfig = { ...this.config, ...options };
		const queue = this.getQueue(mergedConfig.apiKey);

		return queue.add(async () => {
			return this.executeWithRetry(buildCreateRequest(parameters), mergedConfig);
		});
	}

	private buildRetryConfig(config: RequestConfig): {
		maxRetries: number;
		retryableStatuses: Array<number>;
		retryDelay: (attempt: number) => number;
	} {
		const retryableStatuses = config.retryableStatuses ?? [429, 500, 502, 503, 504];

		return {
			maxRetries: config.maxRetries ?? 3,
			retryableStatuses,
			retryDelay:
				config.retryDelay ??
				((attemptNumber: number) => Math.min(1000 * 2 ** attemptNumber, 30000)),
		};
	}

	private async executeWithRetry(
		request: HttpRequest,
		config: RequestConfig,
	): Promise<Result<GamePass, OpenCloudError>> {
		const retryConfig = this.buildRetryConfig(config);
		let lastError: OpenCloudError | undefined;

		for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
			this.config.onRequest?.(request);
			const result = await this.http.request(request, config);

			if (result.success) {
				return {
					data: parseGamePassResponse(result.data.body),
					success: true,
				};
			}

			lastError = result.err;

			if (!this.shouldRetry(result.err, retryConfig) || attempt === retryConfig.maxRetries) {
				return result;
			}

			this.config.onRetry?.(attempt + 1, result.err);
			await sleep(retryConfig.retryDelay(attempt));
		}

		// Fallback: should never reach here, but TypeScript requires it
		return {
			err: lastError ?? new NetworkError("Request failed after all retry attempts"),
			success: false,
		};
	}

	private getQueue(apiKey: string): RateLimitQueue {
		const existingQueue = this.queues.get(apiKey);

		if (existingQueue) {
			return existingQueue;
		}

		const queue = new RateLimitQueue({
			onWait: this.config.onRateLimit,
			requestsPerMinute: GAME_PASSES_RATE_LIMIT.requestsPerMinute,
			requestsPerSecond: GAME_PASSES_RATE_LIMIT.requestsPerSecond,
		});
		this.queues.set(apiKey, queue);
		return queue;
	}

	private shouldRetry(
		error: OpenCloudError,
		config: { retryableStatuses: Array<number> },
	): boolean {
		return error instanceof ApiError && config.retryableStatuses.includes(error.statusCode);
	}
}
```

### Rate Limit Research Required

**Implementation Note:** Actual Roblox Open Cloud rate limits must be researched
and documented per API during implementation. The values shown above (60/min,
10/sec) are placeholders.

**Research sources:**

- Roblox Open Cloud documentation
- HTTP 429 response headers (`X-RateLimit-*`)
- Roblox developer forums/announcements

Each client should have its own rate limit constants based on the specific API.

### Benefits

- ✅ **Bedrock doesn't manage queues** - Fire all requests, SDK handles it
- ✅ **Rate limiting automatic** - SDK knows correct limits per API
- ✅ **Retries transparent** - SDK handles, CLI gets notified via hooks
- ✅ **Observability** - CLI knows when retries/rate-limits happen
- ✅ **Testable** - Inject fake HTTP client, no actual rate limiting in tests
- ✅ **Per-key rate limiting** - Different API keys maintain separate quotas

## Idempotency & Retry Strategy

### Idempotency Research

**Research completed:** Roblox Open Cloud API documentation does not specify
support for idempotency headers (such as `Idempotency-Key` or `X-Request-Id`).

**Sources:**

- [Cloud API Reference](https://create.roblox.com/docs/cloud/reference)
- [Common API Patterns](https://create.roblox.com/docs/cloud/reference/patterns)

### Retry Policy for Create Operations

**Problem:** Without idempotency support, retrying failed create operations on
5xx errors could result in duplicate resources.

**Solution:** Different retry strategies based on operation type and error code.

#### Retry Strategy by Operation Type

| Operation Type | 429 (Rate Limit) | 500/502/503/504 (Server Error) |
| -------------- | ---------------- | ------------------------------ |
| **Create**     | ✅ Retry         | ❌ Do not retry                |
| **Read/List**  | ✅ Retry         | ✅ Retry (safe, idempotent)    |
| **Update**     | ✅ Retry         | ✅ Retry (idempotent by PUT)   |
| **Delete**     | ✅ Retry         | ✅ Retry (idempotent)          |

#### Implementation Strategy

**Option 1: Per-method retry configuration (Recommended)**

```typescript
class GamePassesClient {
	public async create(
		parameters: CreateGamePassParams,
		options?: RequestOptions,
	): Promise<Result<GamePass, OpenCloudError>> {
		const mergedConfig = { ...this.config, ...options };
		const queue = this.getQueue(mergedConfig.apiKey);

		return queue.add(async () => {
			return this.executeWithRetry(buildCreateRequest(parameters), {
				...mergedConfig,
				// Create operations: only retry rate limits, not server errors
				retryableStatuses: [429],
			});
		});
	}

	public async get(
		gamePassId: string,
		options?: RequestOptions,
	): Promise<Result<GamePass, OpenCloudError>> {
		const mergedConfig = { ...this.config, ...options };
		const queue = this.getQueue(mergedConfig.apiKey);

		return queue.add(async () => {
			return this.executeWithRetry(buildGetRequest(gamePassId), {
				...mergedConfig,
				// Read operations: retry both rate limits and server errors
				retryableStatuses: [429, 500, 502, 503, 504],
			});
		});
	}
}
```

**Benefits:**

- ✅ Prevents duplicate resources from retried creates
- ✅ Safe retries for idempotent operations (read, update, delete)
- ✅ Users can override retry behavior per request
- ✅ Explicit and self-documenting

**Trade-offs:**

- ⚠️ Users must handle failed create operations manually (no auto-retry on 5xx)
- ⚠️ More verbose than blanket retry policy

### Future: Idempotency Key Support

If Roblox Open Cloud adds idempotency key support in the future:

1. Add `idempotencyKey?: string` to `RequestOptions`
2. Include `Idempotency-Key` header in requests when provided
3. Enable 5xx retries for create operations when idempotency key is present
4. Update documentation with idempotency best practices

## Error Handling

### Error Hierarchy

```text
OpenCloudError (base)
├── RateLimitError (429, includes retryAfterSeconds)
├── ApiError (4xx/5xx with statusCode and code)
├── NetworkError (connection failures, fetch errors)
└── ValidationError (client-side validation)
```

### Implementation

```typescript
export class OpenCloudError extends Error {
	public readonly cause?: unknown;
	public override readonly name = "OpenCloudError";

	constructor(message: string, cause?: unknown) {
		super(message);
		this.cause = cause;
	}
}
```

```typescript
export class ApiError extends OpenCloudError {
	public readonly code?: string;
	public override readonly name = "ApiError";
	public readonly statusCode: number;

	constructor(message: string, statusCode: number, code?: string) {
		super(message);
		this.statusCode = statusCode;
		this.code = code;
	}
}
```

```typescript
export class RateLimitError extends OpenCloudError {
	public override readonly name = "RateLimitError";
	public readonly retryAfterSeconds: number;

	constructor(message: string, retryAfterSeconds: number) {
		super(message);
		this.retryAfterSeconds = retryAfterSeconds;
	}
}
```

### HTTP Layer with Result Types

```typescript
// Internal HTTP client returns Results
export interface HttpClient {
	request(
		request: HttpRequest,
		config: RequestConfig,
	): Promise<Result<HttpResponse, OpenCloudError>>;
}

export function createHttpClient(): HttpClient {
	return {
		async request(request, config) {
			const fetchResult = await performFetch(request, config);

			if (!fetchResult.success) {
				return fetchResult;
			}

			const response = fetchResult.data;
			const bodyResult = await parseResponseBody(response);

			if (!bodyResult.success) {
				return bodyResult;
			}

			if (!response.ok) {
				return {
					err: createErrorFromResponse(response, bodyResult.data),
					success: false,
				};
			}

			return {
				data: {
					body: bodyResult.data,
					headers: Object.fromEntries(response.headers),
					status: response.status,
				},
				success: true,
			};
		},
	};
}

async function parseResponseBody(response: Response): Promise<Result<unknown, OpenCloudError>> {
	const bodyResult = await tryCatch(() => response.json());
	if (!bodyResult.success) {
		return {
			err: new ApiError("Failed to parse response", response.status),
			success: false,
		};
	}

	return { data: bodyResult.data, success: true };
}

// Implementation uses tryCatch helper (from functional skill)
async function performFetch(
	request: HttpRequest,
	config: RequestConfig,
): Promise<Result<Response, OpenCloudError>> {
	const result = await tryCatch(() => {
		return fetch(buildUrl(request, config), buildFetchOptions(request, config));
	});

	if (!result.success) {
		return {
			err: new NetworkError("Network request failed", result.err),
			success: false,
		};
	}

	return { data: result.data, success: true };
}
```

## Package Exports

### Subpath Exports Configuration

```json
{
	"name": "@bedrock/open-cloud",
	"version": "0.1.0",
	"type": "module",
	"exports": {
		".": {
			"types": "./dist/index.d.ts",
			"default": "./dist/index.js"
		},
		"./game-passes": {
			"types": "./dist/resources/game-passes/index.d.ts",
			"default": "./dist/resources/game-passes/index.js"
		},
		"./developer-products": {
			"types": "./dist/resources/developer-products/index.d.ts",
			"default": "./dist/resources/developer-products/index.js"
		},
		"./game-icons": {
			"types": "./dist/resources/game-icons/index.d.ts",
			"default": "./dist/resources/game-icons/index.js"
		},
		"./game-thumbnails": {
			"types": "./dist/resources/game-thumbnails/index.d.ts",
			"default": "./dist/resources/game-thumbnails/index.js"
		},
		"./universes": {
			"types": "./dist/resources/universes/index.d.ts",
			"default": "./dist/resources/universes/index.js"
		}
	},
	"files": ["dist"]
}
```

### Root Export (Minimal Barrel File)

**Following Turborepo recommendations: avoid barrel files that re-export
everything.**

```typescript
export type { RequestOptions, OpenCloudClientOptions } from "./client/types";

// src/index.ts - ONLY shared utilities, NOT resource clients
export { OpenCloudError, RateLimitError, ApiError, NetworkError, ValidationError } from "./errors";
export type { Result } from "./types";
```

### Usage Patterns

```typescript
// ✅ CORRECT - Shared utilities from root
import { RateLimitError, type Result } from "@bedrock/open-cloud";
// ❌ IMPOSSIBLE - Clients NOT exported from root (prevents accidental barrel
// import)
import { GamePassesClient } from "@bedrock/open-cloud"; // TypeScript error!
// ✅ CORRECT - Subpath import (best tree-shaking)
import { GamePassesClient } from "@bedrock/open-cloud/game-passes";
import { UniversesClient } from "@bedrock/open-cloud/universes";
```

**Benefits:**

- Forces explicit subpath imports (optimal tree-shaking)
- Autocomplete can't suggest wrong import path
- Aligns with Turborepo best practices
- Only bundle what you import

## Testing Strategy

### Test Structure

```text
tests/
├── unit/                           # Pure function tests (no I/O)
│   └── resources/
│       └── game-passes/
│           ├── builders.spec.ts    # Test buildCreateRequest(), etc.
│           └── parsers.spec.ts     # Test parseGamePassResponse(), etc.
│
└── integration/                    # Client tests with fake HTTP
    └── resources/
        └── game-passes/
            └── client.spec.ts      # Test GamePassesClient with mocked HTTP
```

### Test Conventions

**Following Bedrock conventions:**

```typescript
// tests/unit/resources/game-passes/builders.spec.ts
import { buildCreateRequest } from "../../../../src/resources/game-passes/builders";

// ✅ Use function reference in describe()
describe(buildCreateRequest, () => {
	it("should build request with required fields", () => {
		const request = buildCreateRequest({
			name: "VIP Pass",
			priceInRobux: 100,
			universeId: "123",
		});

		expect(request).toStrictEqual({
			body: {
				name: "VIP Pass",
				priceInRobux: 100,
			},
			method: "POST",
			url: "/cloud/v2/universes/123/game-passes",
		});
	});

	it("should include optional description", () => {
		const request = buildCreateRequest({
			name: "VIP Pass",
			description: "Access VIP area",
			priceInRobux: 100,
			universeId: "123",
		});

		expect(request.body).toHaveProperty("description", "Access VIP area");
	});
});
```

### Integration Tests

```typescript
// tests/integration/resources/game-passes/client.spec.ts
import { GamePassesClient } from "../../../../src/resources/game-passes";
import { createFakeHttpClient } from "../../../helpers/fake-http-client";

function createTestClient(http: HttpClient): GamePassesClient {
	return new GamePassesClient({
		apiKey: "test-key",
		httpClient: http,
	});
}

// eslint-disable-next-line max-lines-per-function -- Describe block
describe(GamePassesClient, () => {
	it("should create game pass successfully", async () => {
		expect.assertions(3);

		const http = createFakeHttpClient();
		http.mockResponse({
			body: {
				name: "VIP Pass",
				createdTimestamp: "2025-01-01T00:00:00Z",
				path: "universes/123/game-passes/456",
				priceInRobux: 100,
				updatedTimestamp: "2025-01-01T00:00:00Z",
			},
			status: 200,
		});

		const client = createTestClient(http);
		const result = await client.create({
			name: "VIP Pass",
			priceInRobux: 100,
			universeId: "123",
		});

		expect(result.success).toBe(true);

		assert(result.success);

		expect(result.data.id).toBe("456");
		expect(result.data.name).toBe("VIP Pass");
	});

	it("should handle rate limit errors", async () => {
		expect.assertions(3);

		const http = createFakeHttpClient();
		http.mockError(new RateLimitError("Rate limited", 60));

		const client = createTestClient(http);
		const result = await client.create({
			name: "VIP Pass",
			priceInRobux: 100,
			universeId: "123",
		});

		expect(result.success).toBe(false);

		assert(!result.success);

		expect(result.err).toBeInstanceOf(RateLimitError);
		expect(result.err.retryAfterSeconds).toBe(60);
	});
});
```

### Coverage Target

**100% coverage** (statements, branches, functions, lines) required per ADR-003.

## Dependencies

### Zero Runtime Dependencies

```json
{
	"dependencies": {},
	"devDependencies": {
		"@bedrock/typescript-config": "workspace:*",
		"@bedrock/vitest-config": "workspace:*",
		"@types/bun": "catalog:types",
		"tsdown": "catalog:build",
		"typescript": "catalog:tsc",
		"vitest": "catalog:test"
	},
	"engines": {
		"node": ">=24.12.0",
		"bun": ">=1.3.0"
	}
}
```

## Runtime Compatibility

**Dual Runtime Support:** Node.js LTS (24.12+) and Bun 1.3+

**Node.js LTS (24.12+) requirements:**

- Native `fetch()` API (no polyfills)
- `FormData` and Web Streams API
- `TextEncoder`/`TextDecoder` built-in

**API Strategy:** Use **standard web APIs exclusively**:

- ✅ `fetch()` - HTTP requests
- ✅ `Uint8Array` - Binary data (not Node.js Buffer)
- ✅ `TextEncoder`/`TextDecoder` - Text encoding
- ✅ `FormData` - Multipart encoding

**No Bun-specific APIs** to ensure Node.js compatibility.

## Security Considerations

### API Key Security

**Storage:**

- ✅ API keys should be stored in environment variables, not hardcoded
- ✅ Use `.env` files with `.gitignore` for local development
- ✅ Use secure secret management (Vault, AWS Secrets Manager) in production
- ❌ Never commit API keys to version control
- ❌ Never log API keys (even in debug mode)

**SDK Behavior:**

- SDK does not persist or cache API keys beyond client instance lifetime
- SDK does not log API keys in error messages or observability hooks
- SDK does not validate key format (API is source of truth)
- Keys are passed in request headers over HTTPS only

**User Guidance (for SDK documentation):**

```typescript
// ❌ BAD: Hardcoded key
const client = new GamePassesClient({ apiKey: "abc123..." });

// ✅ GOOD: Environment variable
const client = new GamePassesClient({
	apiKey: process.env.ROBLOX_API_KEY ?? "",
});

// ✅ BETTER: Validate environment variable exists
const apiKey = process.env.ROBLOX_API_KEY;

if (!apiKey) {
	throw new Error("ROBLOX_API_KEY environment variable is required");
}

const client = new GamePassesClient({ apiKey });
```

### API Key Rotation

**Recommended practices for users:**

1. Use different API keys for different permission levels
2. Rotate keys periodically (e.g., every 90 days)
3. Revoke compromised keys immediately via Roblox Creator Dashboard
4. Use separate keys for CI/CD vs local development

**SDK support:**

- Per-request key override enables gradual key migration
- No client restart needed - just override key in request options

```typescript
// Migrate to new key without client restart
const result = await client.create(params, {
	apiKey: rotatedApiKey,
});
```

### Permission Scoping

**Best practices for users:**

- Create API keys with minimal required permissions (principle of least
  privilege)
- Use separate keys for asset uploads (moderation risk isolation)
- Audit key permissions regularly

**Example permission strategy:**

```text
Key 1 (Read-only): List/get operations only
Key 2 (Deploy): Create/update universe settings, places
Key 3 (Assets): Upload game icons, thumbnails (high moderation risk)
Key 4 (Products): Manage game passes, developer products
```

### HTTPS Enforcement

**SDK behavior:**

- All requests use HTTPS by default
- No option to disable HTTPS (security by design)
- `baseUrl` override must use `https://` protocol
- HTTP URLs rejected with ValidationError

### Dependency Security

**Zero runtime dependencies:**

- Eliminates supply chain attack surface
- No transitive dependency vulnerabilities
- Faster security audits (only SDK code to review)

**Development dependencies:**

- Use Bun's catalog for version management
- Run `pnpm audit` / `bun audit` regularly
- Update dependencies via Dependabot or Renovate

### Error Message Sanitization

**Principle:** Error messages should not leak sensitive information.

**Implementation:**

- API keys never included in error messages or stack traces
- Request URLs sanitized to remove query parameters with sensitive data
- Response bodies only included if non-sensitive (never full auth errors)

```typescript
// ❌ BAD: Leaks API key
throw new Error(`Request failed: GET ${url}?api_key=${apiKey}`);

// ✅ GOOD: Sanitized
throw new NetworkError("Request failed: GET /cloud/v2/universes/123");
```

## Design Rationale

### Why Class-Based Clients?

| Approach   | Decision      | Rationale                                           |
| ---------- | ------------- | --------------------------------------------------- |
| **Class**  | ✅ **Chosen** | Natural encapsulation of config state               |
| Factory Fn | ❌ Rejected   | No practical benefit over classes for this use case |

### Why Result Types Over Exceptions?

| Approach        | Decision      | Rationale                                 |
| --------------- | ------------- | ----------------------------------------- |
| **Result Type** | ✅ **Chosen** | Explicit errors, functional, type-safe    |
| Exceptions      | ❌ Rejected   | Hidden control flow, not visible in types |

### Why Subpath Exports Over Multiple Packages?

| Approach            | Decision      | Rationale                                 |
| ------------------- | ------------- | ----------------------------------------- |
| **Subpath Exports** | ✅ **Chosen** | Single install, optimal tree-shaking      |
| Multiple Packages   | ❌ Rejected   | Installation friction, version management |
| Monolithic Package  | ❌ Rejected   | Poor tree-shaking, bundles unused code    |

### Why Simplified Architecture Over FCIS?

| Approach       | Decision      | Rationale                                             |
| -------------- | ------------- | ----------------------------------------------------- |
| **Simplified** | ✅ **Chosen** | SDK is I/O layer, not application with business logic |
| FCIS (Strict)  | ❌ Rejected   | Over-engineering for HTTP client library              |

**Clarification:** ADR-002 prescribes FCIS for the **Bedrock CLI**
(application), not for library packages like Open Cloud SDK.

## Implementation Notes

### Critical First Steps

1. **Set up package structure** with subpath exports
2. **Implement shared utilities**:
    - `tryCatch` helper (from functional skill)
    - `Result` type
    - Error classes
    - HTTP client with Result types
3. **Implement one service end-to-end** (Game Passes):
    - Client class
    - Builders (pure)
    - Parsers (pure)
    - Unit tests
    - Integration tests
4. **Validate pattern** before replicating to other services

### TDD Workflow (ADR-003)

**RED → GREEN → REFACTOR for every feature:**

1. **RED**: Write failing test
2. **GREEN**: Write minimal code to pass
3. **REFACTOR**: Improve code (commit before refactoring)

**Git history must show TDD compliance.**

## Publishing & Release Process

### npm Package Scope

**Package name:** `@bedrock/open-cloud`

**Scope availability:** Must verify `@bedrock` scope is available on npm or
create organization account.

**Alternative:** If `@bedrock` unavailable, consider `@bedrock-cli/open-cloud`
or `@roblox-bedrock/open-cloud`.

### Version Management

**Strategy:** [Changesets](https://github.com/changesets/changesets)

**Why changesets:**

- Automated changelog generation
- Semantic versioning enforcement
- Monorepo-friendly (future packages)
- Consumer-focused release notes

**Workflow:**

1. Developer creates changeset: `pnpm changeset`
2. CI validates changeset exists for PR
3. Merge to main triggers changeset action
4. Bot creates "Version Packages" PR with bumped versions + changelog
5. Merge version PR → automated npm publish

### Pre-Release Testing

**Before publishing to npm:**

- ✅ All tests pass (`pnpm test`)
- ✅ Build succeeds (`pnpm build`)
- ✅ Type checking passes (`pnpm typecheck`)
- ✅ Linting passes (`pnpm lint`)
- ✅ No uncommitted changes
- ✅ CHANGELOG.md updated
- ✅ Version bumped in package.json

**Optional (manual testing):**

- Test in consuming project via `pnpm link`
- Test E2E with real Roblox API (requires API key)
- Verify bundle size meets targets

### Publishing Strategy

**CI/CD Pipeline (GitHub Actions):**

```yaml
name: Publish
on:
  push:
    branches: [main]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun test
      - run: bun run build
      - env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: bunx @changesets/action publish
```

**Protection:**

- Require passing CI before merge
- Require changeset for all PRs
- Use npm automation tokens (not personal tokens)

### Pre-Release Versions

**Alpha/Beta testing:**

```bash
# Create pre-release
pnpm changeset pre enter alpha
pnpm changeset version
pnpm publish --tag alpha

# Exit pre-release mode
pnpm changeset pre exit
```

**Use cases:**

- Alpha: Breaking changes, experimental features
- Beta: Stable but not battle-tested
- RC (release candidate): Final testing before stable

### Release Checklist

**For every release:**

- [ ] All tests passing on CI
- [ ] Changelog generated and reviewed
- [ ] Version follows semver (breaking = major, feature = minor, fix = patch)
- [ ] Documentation updated (if API changed)
- [ ] Migration guide (if breaking changes)
- [ ] GitHub release created with notes
- [ ] npm publish succeeded
- [ ] Verify installation: `npm install @bedrock/open-cloud@latest`

### Documentation Publishing

**Strategy:** Auto-generate TypeScript docs with [TypeDoc](https://typedoc.org/)

**Workflow:**

1. Generate docs: `pnpm typedoc`
2. Publish to GitHub Pages via CI
3. Link from README: `https://bedrock.github.io/open-cloud/`

**Alternative:** Use npm package docs if GitHub Pages unavailable.

### Bundle Size Monitoring

**Tools:** [bundlephobia](https://bundlephobia.com/) or size-limit

**Targets:**

- Minimal import (errors + types): < 1KB gzipped
- Single resource client: < 5KB gzipped
- Full SDK: < 15KB gzipped

**CI check:**

```json
{
	"devDependencies": {
		"size-limit": "^11.0.0"
	},
	"size-limit": [
		{
			"path": "dist/index.js",
			"limit": "1 KB"
		},
		{
			"path": "dist/resources/game-passes/index.js",
			"limit": "5 KB"
		}
	]
}
```

### Deprecation Policy

**When deprecating features:**

1. Add `@deprecated` JSDoc tag with migration path
2. Log deprecation warning at runtime (once per client instance)
3. Document in changelog under "Deprecated" section
4. Wait 2+ minor versions before removal
5. Remove in next major version

**Example:**

```typescript
/**
 * Creates a game pass (deprecated).
 *
 * @deprecated Use `create()` instead. Will be removed in v2.0.0.
 * @param parameters - Parameters for creating a game pass.
 * @returns Result containing game pass or error.
 */
export async function createGamePass(
	...parameters: Parameters<typeof this.create>
): Promise<Result<GamePass>> {
	console.warn(
		"createGamePass() is deprecated. Use create() instead. " +
			"This method will be removed in v2.0.0.",
	);

	return this.create(...parameters);
}
```

## Constraints & Requirements

### Must Have

- ✅ Simplified architecture (pure builders/parsers, clear structure)
- ✅ Open Cloud only (ADR-007)
- ✅ TDD with 100% coverage (ADR-003)
- ✅ TypeScript with Bun
- ✅ ES modules only
- ✅ Standalone/publishable to npm
- ✅ Result types (functional skill)
- ✅ Subpath exports (tree-shaking)
- ✅ Rate limiting (SDK-managed queuing)
- ✅ Automatic retries with exponential backoff
- ✅ Observability hooks (onRequest, onRetry, onRateLimit)

### Should Have

- Rich error handling with typed errors
- Multipart file upload support
- Pagination support
- Per-request configuration override

### Won't Have (v0.1)

- OAuth 2.0 support (API keys only)
- Additional services beyond v0.1 scope
- Avatar settings (Studio-only)
- Idempotency support (requires Roblox API support verification)

## Related Decisions

- **ADR-001**: TypeScript with Bun - runtime and tooling
- **ADR-002**: FCIS for CLI - **does not apply to SDK** (SDK is I/O layer)
- **ADR-003**: Testing strategy - TDD, 100% coverage
- **ADR-007**: Open Cloud only - no legacy APIs

## Mantle Migration Path

**CLAUDE.md Constraint:** "Maintain Mantle migration path"

**Scope:** This constraint applies to the **Bedrock CLI**, not this SDK package.

The Open Cloud SDK is a low-level HTTP client library that provides access to
Roblox APIs. Migration from Mantle to Bedrock is a CLI-layer concern involving:

- State format conversion (Mantle YAML → Bedrock state backend)
- Configuration migration (Mantle config → Bedrock c12 config)
- Command equivalence (Mantle CLI → Bedrock CLI)
- Resource mapping (Mantle resource IDs → Open Cloud resource paths)

**SDK's Role:** The SDK provides the API layer that the Bedrock CLI uses to
interact with Roblox. It doesn't need Mantle-specific compatibility because:

1. Mantle used Rust with different HTTP patterns - no API compatibility needed
2. Migration happens at CLI level (state + config transformation)
3. SDK just needs to support Open Cloud APIs correctly
4. CLI will map Mantle concepts → Open Cloud API calls via this SDK

**Conclusion:** No Mantle-specific design required in SDK. Migration path is
maintained at CLI layer using this SDK as the API foundation.

## References

- [Stainless SDK Best Practices](https://www.stainless.com/sdk-api-best-practices/modern-sdk-development-for-complex-apis)
- [OpenAI Node.js SDK](https://github.com/openai/openai-node)
- [AWS SDK v3 Architecture](https://github.com/aws/aws-sdk-js-v3)
- [Building Great SDKs](https://newsletter.pragmaticengineer.com/p/building-great-sdks)
- [Turborepo Performance](https://turbo.build/repo/docs/crafting-your-repository/structuring-a-repository#avoid-barrel-files)
- [Roblox Open Cloud Documentation](https://create.roblox.com/docs/cloud)
- [Functional Core, Imperative Shell](https://www.destroyallsoftware.com/screencasts/catalog/functional-core-imperative-shell)
