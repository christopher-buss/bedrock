# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Package Overview

`@bedrock/open-cloud` is a standalone TypeScript HTTP client for Roblox Open
Cloud APIs. This package is designed to be publishable to npm and usable
independently of the Bedrock CLI.

**Key characteristics:**

- Zero runtime dependencies
- Class-based clients with immutable configuration
- Result types (no exceptions) for explicit error handling
- Subpath exports for optimal tree-shaking
- 100% test coverage requirement
- Dual runtime support: Node.js LTS (24.12+) and Bun 1.3+

## Common Commands

```bash
# Development
pnpm build          # Build for production (tsdown)
pnpm dev            # Watch mode (stub compilation)
pnpm test           # Run tests (vitest)
pnpm lint           # Lint source files (eslint)
pnpm typecheck      # Type checking (tsgo)

# Run a single test file
pnpm test src/path/to/file.spec.ts

# Run tests in watch mode
pnpm test --watch

# Run tests with coverage
pnpm test --coverage
```

## Architecture

### Package Structure

```text
src/
├── resources/           # Service clients (public API via subpath exports)
│   ├── game-passes/
│   │   ├── index.ts    # GamePassesClient class
│   │   ├── types.ts    # Public types
│   │   ├── builders.ts # Pure: request builders
│   │   └── parsers.ts  # Pure: response parsers
│   ├── developer-products/
│   ├── game-icons/
│   ├── game-thumbnails/
│   └── universes/
│
├── internal/           # Internal utilities (NOT exported)
│   ├── http/
│   │   ├── fetch-client.ts      # HTTP implementation
│   │   ├── rate-limit-queue.ts  # Rate limiting & queuing
│   │   ├── multipart.ts         # Multipart encoding
│   │   └── types.ts             # HttpRequest, HttpResponse
│   └── utils/
│       └── try-catch.ts         # tryCatch helper
│
├── errors/             # Error classes (exported from root)
│   ├── base.ts        # OpenCloudError
│   ├── rate-limit.ts  # RateLimitError
│   ├── api-error.ts   # ApiError
│   ├── network-error.ts
│   └── validation-error.ts
│
├── client/            # Shared client types
│   └── types.ts       # OpenCloudClientOptions, RequestOptions
│
├── types.ts           # Shared types (Result, etc.)
└── index.ts           # Root export (errors + shared types only)

tests/
├── helpers/           # Test utilities
│   └── fake-http-client.ts
├── unit/              # Pure function tests (builders, parsers)
│   └── resources/
└── integration/       # Client tests with fake HTTP
    └── resources/
```

### FCIS Architecture Context

The Bedrock CLI follows FCIS (Functional Core, Imperative Shell) architecture
and will have an "Open Cloud Port" interface. This `@bedrock/open-cloud` package
is the adapter implementation for that port.

**Package structure:**

- Pure builders (testable request construction)
- Pure parsers (testable response parsing)
- Result types (explicit error handling)
- Immutable config (no hidden state)
- HTTP client implementation

## Design Principles

### 1. Result Types Over Exceptions

All client methods return `Promise<Result<T, OpenCloudError>>`:

```typescript
const result = await client.create(params);
if (!result.success) {
	// Handle error explicitly
	console.error(result.err.message);
	return;
}

// TypeScript knows result.data exists here
console.log(result.data.id);
```

### 2. Per-Request Configuration Override

Clients support per-request config overrides (Stainless SDK pattern):

```typescript
const client = new GamePassesClient({ apiKey: "main-key" });

// Override for this request only
const result = await client.create(params, {
	apiKey: "asset-upload-key", // Different key for moderation safety
	timeout: 60000,
});
```

### 3. Subpath Exports (No Barrel Files)

Import from subpaths, NOT the root:

```typescript
// ❌ WRONG - Root import not available for clients
import { GamePassesClient } from "@bedrock/open-cloud";
// ✅ CORRECT - Root only exports shared utilities
import { RateLimitError, type Result } from "@bedrock/open-cloud";
// ✅ CORRECT - Subpath import
import { GamePassesClient } from "@bedrock/open-cloud/game-passes";
```

### 4. Rate Limiting Built-In

SDK manages concurrency and rate limiting internally. Bedrock CLI can fire all
requests at once - the SDK queues them automatically.

Each client has built-in rate limits based on Roblox's documented API limits.
Users don't configure them.

### 5. Idempotency-Aware Retries

Different retry strategies based on operation type:

| Operation | 429 (Rate Limit) | 5xx (Server Error) |
| --------- | ---------------- | ------------------ |
| Create    | ✅ Retry         | ❌ Do not retry    |
| Read/List | ✅ Retry         | ✅ Retry           |
| Update    | ✅ Retry         | ✅ Retry           |
| Delete    | ✅ Retry         | ✅ Retry           |

Create operations only retry rate limits to prevent duplicate resources (Roblox
doesn't support idempotency keys).

## Testing Requirements

### 100% Coverage (NON-NEGOTIABLE)

Every line of production code must be written in response to a failing test.

**RED → GREEN → REFACTOR cycle:**

1. **RED:** Write failing test for desired behavior
2. **GREEN:** Write minimum code to pass
3. **REFACTOR:** Clean up while tests stay green

**Commit cadence:** The pre-commit hook runs lint, typecheck, test, and build,
so a pure-RED commit is rejected. Work RED → GREEN in the working tree, then
commit RED + GREEN **together** as one commit per behaviour slice. REFACTOR
lands as a separate commit only when refactoring adds value.

### Test Levels

| Layer    | Test with         | Location             | Isolation   |
| -------- | ----------------- | -------------------- | ----------- |
| Builders | Unit tests        | `tests/unit/`        | None needed |
| Parsers  | Unit tests        | `tests/unit/`        | None needed |
| Clients  | Integration tests | `tests/integration/` | Fake HTTP   |

### Test Conventions

```typescript
// ✅ Use function reference in describe()
describe(buildCreateRequest, () => {
	it("should build request with required fields", () => {
		// Test pure function
	});
});

// Integration tests inject fake HTTP client
const http = createFakeHttpClient();
const client = new GamePassesClient({
	apiKey: "test-key",
	httpClient: http, // Inject for testing
});
```

### Coverage Target

100% required (statements, branches, functions, lines) per ADR-003.

## Type System Guidelines

1. **TypeScript-first**: camelCase (not snake_case like Roblox API)
2. **Strict types**: No `any`, prefer `unknown` for untyped data
3. **Readonly responses**: All response types immutable
4. **Export everything**: All public types exported for consumers

```typescript
// Response types are readonly
export interface GamePass {
	readonly id: string;
	readonly name: string;
	readonly priceInRobux: number;
}
```

## Security Considerations

1. **API keys**: Never log or expose in error messages
2. **HTTPS only**: No option to disable HTTPS
3. **Zero dependencies**: Eliminates supply chain attack surface
4. **Error sanitization**: No sensitive data in error messages

## Implementation Notes

### Critical First Steps

1. Implement shared utilities (tryCatch, Result, errors, HTTP client)
2. Implement one service end-to-end (Game Passes) to validate pattern
3. Replicate pattern to other services only after validation

### Pure Functions (Builders & Parsers)

- **Builders**: Take parameters, return HttpRequest (no I/O)
- **Parsers**: Take response body, return domain object (no I/O)
- Both are pure functions - easy to test without mocks

### Client Classes

- Encapsulate immutable config
- Coordinate builders, HTTP, parsers
- Return Result types
- Manage rate limiting per API key

## v0.1 Scope

**Supported APIs:**

- Game Passes
- Developer Products
- Game Icons
- Game Thumbnails
- Universes

**Out of Scope:**

- OAuth 2.0 (API keys only)
- Data stores
- Groups/Users
- Avatar settings

## Runtime Compatibility

**Supported runtimes:**

- Node.js LTS (24.12+) (native fetch, FormData, TextEncoder)
- Bun 1.3+

**Use standard web APIs exclusively:**

- `fetch()` for HTTP
- `Uint8Array` for binary (NOT Node.js Buffer)
- `TextEncoder`/`TextDecoder` for encoding
- `FormData` for multipart

No Bun-specific APIs to ensure Node.js compatibility.

## Related Documentation

- Design plan: `/docs/plans/2025-12-13-open-cloud-package-design.md`
- Root CLAUDE.md for Bedrock project context
- ADR-003: Testing strategy (TDD, 100% coverage)
- ADR-007: Open Cloud only (no legacy APIs)
