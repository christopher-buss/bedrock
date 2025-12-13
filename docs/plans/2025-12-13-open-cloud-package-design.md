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
│   │   │   ├── types.ts              # HttpRequest, HttpResponse
│   │   │   └── fake-client.ts        # Test utility
│   │   └── utils/
│   │       ├── try-catch.ts          # tryCatch helper
│   │       └── multipart.ts          # Multipart encoding
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
export type Result<T, E = Error> =
	| { data: T; success: true }
	| { error: E; success: false };

// All client methods return Promise<Result<T, OpenCloudError>>
const result = await client.create(params);

if (!result.success) {
	if (result.error instanceof RateLimitError) {
		await sleep(result.error.retryAfterSeconds * 1000);
		// retry...
	} else {
		console.error("Failed:", result.error.message);
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
	// cspell:disable-next-line
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
	onRequest: (request) => console.log(`[REQUEST] ${request.method} ${request.url}`),
	onRetry: (attempt, error) =>
		console.log(`[RETRY ${attempt}] ${error.message}`),
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
	private readonly queue: RateLimitQueue;

	constructor(options: OpenCloudClientOptions) {
		this.config = Object.freeze({ ...options });
		this.queue = new RateLimitQueue({
			onWait: options.onRateLimit,
			requestsPerMinute: GAME_PASSES_RATE_LIMIT.requestsPerMinute,
			requestsPerSecond: GAME_PASSES_RATE_LIMIT.requestsPerSecond,
		});
	}

	public async create(
		parameters: CreateGamePassParams,
		options?: RequestOptions,
	): Promise<Result<GamePass, OpenCloudError>> {
		return this.queue.add(async () => {
			return this.executeWithRetry(buildCreateRequest(parameters), {
				...this.config,
				...options,
			});
		});
	}

	private buildRetryConfig(config: RequestConfig): {
		maxRetries: number;
		retryableStatuses: Array<number>;
		retryDelay: (attempt: number) => number;
	} {
		const retryableStatuses = config.retryableStatuses ?? [
			429, 500, 502, 503, 504,
		];

		return {
			maxRetries: config.maxRetries ?? 3,
			retryableStatuses,
			retryDelay:
				config.retryDelay ??
				((attemptNumber: number) =>
					Math.min(1000 * 2 ** attemptNumber, 30000)),
		};
	}

	private async executeWithRetry(
		request: HttpRequest,
		config: RequestConfig,
	): Promise<Result<GamePass, OpenCloudError>> {
		const retryConfig = this.buildRetryConfig(config);

		for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
			this.config.onRequest?.(request);
			const result = await this.http.request(request, config);

			if (result.success) {
				return {
					data: parseGamePassResponse(result.data.body),
					success: true,
				};
			}

			if (
				!this.shouldRetry(result.error, retryConfig) ||
				attempt === retryConfig.maxRetries
			) {
				return result;
			}

			this.config.onRetry?.(attempt + 1, result.error);
			await sleep(retryConfig.retryDelay(attempt));
		}
	}

	private shouldRetry(
		error: OpenCloudError,
		config: { retryableStatuses: Array<number> }, // cspell:disable-line
	): boolean {
		return (
			error instanceof ApiError &&
			config.retryableStatuses.includes(error.statusCode) // cspell:disable-line
		);
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
					error: createErrorFromResponse(response, bodyResult.data),
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

async function parseResponseBody(
	response: Response,
): Promise<Result<unknown, OpenCloudError>> {
	const bodyResult = await tryCatch(() => response.json());

	if (!bodyResult.success) {
		return {
			error: new ApiError("Failed to parse response", response.status),
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
		return fetch(
			buildUrl(request, config),
			buildFetchOptions(request, config),
		);
	});

	if (!result.success) {
		return {
			error: new NetworkError("Network request failed", result.err),
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
export {
	OpenCloudError,
	RateLimitError,
	ApiError,
	NetworkError,
	ValidationError,
} from "./errors";
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
import { createFakeHttpClient } from "../../../../src/internal/http/fake-client";
// tests/integration/resources/game-passes/client.spec.ts
import { GamePassesClient } from "../../../../src/resources/game-passes";

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

		expect(result.error).toBeInstanceOf(RateLimitError);
		expect(result.error.retryAfterSeconds).toBe(60);
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
		"node": ">=18.0.0",
		"bun": ">=1.0.0"
	}
}
```

## Runtime Compatibility

**Dual Runtime Support:** Node.js 18+ and Bun 1.0+

**Node.js 18+ requirements:**

- Native `fetch()` API (no polyfills)
- `FormData` and Web Streams API
- `TextEncoder`/`TextDecoder` built-in

**API Strategy:** Use **standard web APIs exclusively**:

- ✅ `fetch()` - HTTP requests
- ✅ `Uint8Array` - Binary data (not Node.js Buffer)
- ✅ `TextEncoder`/`TextDecoder` - Text encoding
- ✅ `FormData` - Multipart encoding

**No Bun-specific APIs** to ensure Node.js compatibility.

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

## References

- [Stainless SDK Best Practices](https://www.stainless.com/sdk-api-best-practices/modern-sdk-development-for-complex-apis)
- [OpenAI Node.js SDK](https://github.com/openai/openai-node)
- [AWS SDK v3 Architecture](https://github.com/aws/aws-sdk-js-v3)
- [Building Great SDKs](https://newsletter.pragmaticengineer.com/p/building-great-sdks)
- [Turborepo Performance](https://turbo.build/repo/docs/crafting-your-repository/structuring-a-repository#avoid-barrel-files)
- [Roblox Open Cloud Documentation](https://create.roblox.com/docs/cloud)
- [Functional Core, Imperative Shell](https://www.destroyallsoftware.com/screencasts/catalog/functional-core-imperative-shell)
