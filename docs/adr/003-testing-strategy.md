# ADR-003: Testing Strategy

Date: 2025-12-06 Status: Accepted

Decision Makers: Maintainer Tags: testing, quality, ci, vitest

## Context

Bedrock is an Infrastructure-as-Code tool for Roblox deployment. As an
AI-assisted project, we need high confidence that generated code is correct,
tests verify real behavior, and API changes are detected quickly.

Requirements:

- Tests must catch actual bugs, not just verify mocks
- Tests should be readable specifications of behavior
- Fast feedback during development
- Detect Roblox Open Cloud API drift before releases
- 100% code coverage with no exceptions

Architecture context: FCIS (Functional Core, Imperative Shell) with Ports
pattern (see ADR-002).

## Decision

### Testing Philosophy

**Primary goal:** Confidence in AI-assisted development.

**Mandatory approach: Test-Driven Development (TDD)**

All features must follow the RED-GREEN-REFACTOR cycle:

1. **RED** - Write a failing test that describes the expected behavior
2. **GREEN** - Write the minimum code to make the test pass
3. **REFACTOR** - Clean up while keeping tests green

**No implementation without a failing test first.** This is non-negotiable. TDD
ensures:

- Tests actually verify behavior (they failed before implementation)
- Implementation matches specification (test came first)
- No untested code paths (everything was driven by a test)
- Anti-patterns are structurally prevented (you can't test mocks if you write
  tests first)

Tests must:

- Catch actual bugs (not just verify mock configuration)
- Verify intent (readable specifications)
- Serve as proofs (anyone can understand guarantees)
- Cover edge cases (force thinking through boundaries)

**Anti-patterns explicitly rejected:**

- Testing mock behavior instead of real behavior
- Test-only methods in production code
- Mocking without understanding dependencies
- Incomplete mocks that miss fields
- Writing implementation before tests

### Test Levels (Aligned with FCIS)

| Layer        | What                 | How               | Isolation                |
| ------------ | -------------------- | ----------------- | ------------------------ |
| **Core**     | Pure functions       | Unit tests        | None needed              |
| **Shell**    | I/O orchestration    | Integration tests | Fake adapters            |
| **Adapters** | Port implementations | Adapter tests     | nock for HTTP boundaries |
| **E2E**      | Multi-step workflows | Scenario tests    | Real APIs                |

**Clarification on isolation:**

- **Fake adapters** test shell orchestration by providing in-memory
  implementations
- **nock** tests adapter HTTP handling (status codes, headers, error responses)
- Shell tests use fakes; adapter tests use nock at the HTTP boundary

### Tooling

| Tool                   | Purpose                                  |
| ---------------------- | ---------------------------------------- |
| **Vitest**             | Test runner (all levels)                 |
| **Vitest --typecheck** | Type tests using `expectTypeOf`          |
| **v8**                 | Coverage provider                        |
| **Fake adapters**      | In-memory implementations for fast tests |
| **nock**               | HTTP interception for adapter tests      |

**Fake adapters vs mocks:**

Fake adapters are in-memory implementations of port interfaces that have
**working logic** (store data, throw real errors, enforce constraints). Unlike
mocks that return canned responses, fakes behave like the real implementation.

```typescript
// Fake - has real behavior
class FakeStateBackend implements StateBackend {
	private state: null | State = null;

	public async read(): Promise<State> {
		if (!this.state) {
			throw new NotFoundError();
		}

		return this.state;
	}

	public async write(state: State): Promise<void> {
		this.state = state;
	}
}

// Mock - just returns canned data (AVOID)
const mockBackend = {
	read: vi.fn().mockResolvedValue({ deployed: true }),
};
```

This distinction is critical: tests using fakes verify real behavior, tests
using mocks often just verify the mock is configured correctly.

### Test Writing Conventions

**Naming (enforced by ESLint):**

- Use `it()` with "should" prefix: `it("should throw when config missing")`
- File naming: `*.spec.ts`

**Structure: Arrange-Act-Assert (AAA)**

```typescript
it("should return deployed state after successful deploy", () => {
	// Arrange
	const config = createTestConfig({ experience: "test-game" });
	const backend = new FakeStateBackend();
	const cli = new BedrockCLI({ stateBackend: backend });

	// Act
	const result = cli.deploy(config);

	// Assert
	expect(result.status).toBe("deployed");
	expect(backend.state).toMatchObject({ deployed: true });
});
```

**Type testing:**

```typescript
it("should accept valid config type", () => {
	expectTypeOf<BedrockConfig>().toHaveProperty("experience");
});
```

### Type Testing

Type tests validate compile-time behavior using `expectTypeOf`. They run via
`--typecheck` flag and are **compile-time only** (no runtime execution).

**File naming:** `*.spec-d.ts` (separate from runtime tests)

**When to type test:**

- Public API types (config schemas, command parsers)
- Complex generics and utility types
- Type inference behavior
- Preventing type regressions

**When NOT to type test:**

- Simple concrete types
- Internal application types
- Self-evident types

**Available assertions:**

| Assertion               | Purpose                    |
| ----------------------- | -------------------------- |
| `.toEqualTypeOf<T>()`   | Exact type equality        |
| `.toExtend<T>()`        | Structural subtyping       |
| `.toMatchObjectType<T>` | Strict object matching     |
| `.toBeString()`, etc.   | Primitive checks           |
| `.returns`              | Function return type       |
| `.parameter(n)`         | Specific function argument |
| `.not`                  | Negate any assertion       |

**Example type tests:**

```typescript
// tests/types/config.spec-d.ts
import { expectTypeOf } from "vitest";

import type { BedrockConfig, StateBackend } from "../../src/config";

describe("config types", () => {
	it("should require experience property", () => {
		expectTypeOf<BedrockConfig>().toHaveProperty("experience");
	});

	it("should infer state backend type", () => {
		expectTypeOf<StateBackend>().toExtend<{
			read: () => Promise<unknown>;
		}>();
	});

	it("should reject invalid state backend", () => {
		// @ts-expect-error 'invalid' is not a valid backend
		expectTypeOf({
			state: { backend: "invalid" },
		}).toExtend<BedrockConfig>();
	});
});
```

**Negative testing with `@ts-expect-error`:**

Use `@ts-expect-error` to verify types correctly reject invalid inputs. The test
fails if the line compiles successfully.

**Configuration:**

```typescript
// vitest.config.ts
export default defineConfig({
	test: {
		typecheck: {
			enabled: true,
			include: ["**/*.spec-d.ts"],
		},
	},
});
```

**Running type tests:**

```bash
pnpm test --typecheck              # All tests including type checks
pnpm test --typecheck.only         # Only type tests
```

### Coverage Requirements

100% coverage on all metrics, enforced in CI:

```typescript
const coverage = {
	exclude: [
		"**/index.ts", // Barrel exports
		"**/*.spec.ts", // Test files
	],
	provider: "v8",
	thresholds: {
		branches: 100,
		functions: 100,
		lines: 100,
		statements: 100,
	},
};
```

### Test Data

| Type          | Purpose                                          |
| ------------- | ------------------------------------------------ |
| **Fixtures**  | Recorded API responses (JSON via nock recording) |
| **Factories** | Functions for configs/entities                   |

### CI Integration

| Trigger      | What runs                                     |
| ------------ | --------------------------------------------- |
| Every commit | Unit + Integration, coverage gate, type tests |
| Per-PR       | Smoke with real APIs (change verification)    |
| Nightly      | E2E with real APIs (drift detection)          |
| Pre-release  | Full suite                                    |

**Note on terminology:**

- **Type tests** = Vitest tests using `expectTypeOf` in `*.spec-d.ts` files
- **Type checking** = TypeScript validation via `tsgo --noEmit` (separate from
  tests)

### Test Environment

- Dedicated test universe in Roblox for E2E
- Service account for CI credentials
- Start with one universe, expand if parallelism needed

## Consequences

### Positive

- High confidence in AI-generated code correctness
- Fast feedback with fake adapters (milliseconds, not seconds)
- API drift detected within 24 hours via nightly E2E
- Tests serve as living documentation
- ESLint enforces naming conventions automatically

### Negative

- 100% coverage requires discipline (no shortcuts)
- Fake adapters must be maintained alongside real adapters
- Nightly E2E requires dedicated Roblox test infrastructure
- nock fixtures can become stale if not periodically refreshed

### Neutral

- Two test modes: fast (fakes) and thorough (real APIs)
- Separate `apps/e2e` package for scenario tests

## Directory Structure

```text
bedrock/
├── apps/
│   └── e2e/                    # E2E scenario tests (nightly)
│       ├── scenarios/
│       ├── fixtures/
│       └── package.json
├── packages/
│   ├── cli/
│   │   ├── src/
│   │   └── tests/
│   │       ├── unit/
│   │       ├── integration/
│   │       ├── fakes/
│   │       └── factories/
│   └── open-cloud/
│       ├── src/
│       └── tests/
│           ├── unit/
│           └── adapters/       # nock for HTTP
```

## Alternatives Considered

### Jest

**Pros**: Mature, widely used, good documentation.

**Rejected**: Slower than Vitest, less native ESM support. Vitest aligns better
with Vite-based tooling and offers better TypeScript integration.

### MSW (Mock Service Worker)

**Pros**: Network-level interception, reusable across browser/Node.

**Rejected**: More complex setup for CLI tool. nock is simpler for Node-only
HTTP mocking with built-in recording. FCIS architecture means most tests use
fake adapters anyway, not HTTP mocks.

### No coverage threshold

**Pros**: Less friction, trust developers to write good tests.

**Rejected**: AI-assisted development requires verification. 100% coverage
ensures every line has been considered. Explicit exclusions document exceptions.

### Colocated E2E tests

**Pros**: Simpler structure, tests near code.

**Rejected**: E2E tests span multiple packages (CLI + Open Cloud + State).
Separate `apps/e2e` package follows Turborepo conventions for cross-package
testing.

## Implementation Notes

- ESLint rule `vitest/valid-title` enforces "should" prefix
- ESLint rule `vitest/consistent-test-it` enforces `it()` over `test()`
- ESLint rule `vitest/consistent-test-filename` enforces `*.spec.ts`
- nock recording mode captures real API responses for fixtures
- Fake adapters implement port interfaces for type safety

## Related Decisions

- ADR-001: TypeScript with Bun Runtime
- ADR-002: Monorepo with FCIS Architecture

## References

- [Vitest Documentation](https://vitest.dev/)
- [Vitest Coverage](https://vitest.dev/guide/coverage)
- [Vitest Type Testing](https://vitest.dev/guide/testing-types)
- [nock GitHub](https://github.com/nock/nock)
- [scenarist coverage config](https://github.com/citypaul/scenarist) - 100%
  threshold pattern
- [Turborepo Test Organization](https://github.com/vercel/turborepo/discussions/2320)
- [Testing Anti-Patterns](superpowers:testing-anti-patterns skill)

## Amendment: 2026-04-24, distinguish drift detection from change verification

The original CI Integration table pairs "nightly" with "E2E real APIs" under
a single heading of "drift detection". That framing covers only one of the
two reasons to call Roblox in CI. This amendment names the second and
clarifies how both fit.

Two categories of real-API tests exist:

**Drift detection** (the original framing). Nightly, broad, catches changes
on Roblox's side. Bedrock did not change; the world did. A failure opens an
issue and is triaged against the latest Open Cloud release notes. It does
not block merges because nothing in the PR caused it.

**Change verification** (smoke). Runs on every PR and push to main. Narrow
by design: one happy-path call per public surface, exercising the bedrock
change against a real Roblox universe. Catches bedrock-side breakage that
fakes and nock could not see -- wrong URL shape, wrong auth header, a
response parser that agrees with its fixture but disagrees with Roblox.
A failure blocks merge until the bedrock change is fixed.

The two suites differ on cadence (per-PR vs nightly), scope (one path vs
many), and failure semantics (blocker vs tracked issue). They are
complements, not substitutes.

Physical layout under `apps/e2e/`: change-verification tests live in
`apps/e2e/tests/smoke/`. Drift-detection tests will land in
`apps/e2e/tests/drift/` when that suite is built. The `scenarios/`
placeholder in the original Directory Structure section is superseded by
these two subfolders.

The nightly drift suite remains future work. Nothing in the original
Decision or Consequences sections is retracted; this amendment adds a
category, it does not remove one.
