# ADR-009: Result Types Over Exceptions in `@bedrock-rbx/ocale`

**Date:** 2026-04-12 **Status:** Accepted

Decision Makers: Maintainer Tags: error-handling, open-cloud, typescript,
functional, api-design

## Context

`@bedrock-rbx/ocale` is a standalone TypeScript HTTP client library for Roblox
Open Cloud APIs. As a library with a public API surface, it defines the contract
between SDK internals and all consumers (Bedrock CLI, third-party users).

Error handling at a library boundary is an architectural decision: the choice
determines whether callers are forced to handle errors, whether errors are
visible in the type system, and how the SDK interacts with TypeScript's control
flow narrowing.

Constraints:

- **Zero runtime dependencies** (ADR-008 — no fp-ts, Effect, neverthrow)
- **TypeScript-first**: error handling should leverage the type system
- **FCIS alignment** (ADR-002): SDK is consumed by the shell layer; errors must
  propagate cleanly to orchestration code
- **Community accessibility** (ADR-001): heavy FP abstractions are a barrier to
  contribution

Every client method returns `Promise<T>` or throws today in standard JS/TS. The
question is whether errors appear in the return type or only at runtime.

## Decision

`@bedrock-rbx/ocale` uses **discriminated union Result types** for all client
method return values.

```typescript
// src/types.ts
export type Result<T, E = Error> = { data: T; success: true } | { err: E; success: false };
```

Every SDK client method returns `Promise<Result<T, OpenCloudError>>`. Errors are
never thrown from client methods — they are returned as `{ err, success: false }`.

The `Result` type lives in `src/types.ts` within `@bedrock-rbx/ocale` itself
and is exported from the package root. No commitment is made to project-wide
adoption; the Bedrock CLI and other packages decide their own error handling
independently.

## Consequences

### Positive

- **Errors visible in types**: `Promise<Result<T, E>>` declares that failure is
  possible; callers cannot forget to handle it
- **TypeScript narrowing**: `if (!result.success)` narrows `result.err` to
  `OpenCloudError` and `result.data` to `T` — no type assertions needed
- **No hidden control flow**: `try/catch` not required; callers handle errors
  inline with the happy path
- **Zero-dependency implementation**: discriminated union is native TypeScript,
  no library needed
- **Consistent API surface**: all methods fail the same way — consumers learn
  one pattern

### Negative

- **Unfamiliar to some**: developers accustomed to `try/catch` must learn the
  pattern
- **Verbose at call sites**: callers must check `result.success` before
  accessing `result.data`; cannot directly `await` and use the value
- **Error composition overhead**: functions that call other Result-returning
  functions must propagate results manually (no `?` operator like Rust)
- **Scoped to SDK boundary only**: if the Bedrock CLI uses exceptions
  internally, there will be an impedance mismatch at the integration point

### Neutral

- Project-wide adoption is intentionally deferred — the rest of the Bedrock
  project can decide independently
- The `Result` type is exported; consumers who want to use it project-wide can
  import it from `@bedrock-rbx/ocale`

## Alternatives Considered

### Thrown Exceptions

Standard JavaScript/TypeScript error handling — methods throw on failure,
callers use `try/catch`.

**Pros**: familiar to all JS/TS developers, no new patterns, zero boilerplate at
definition sites.

**Rejected because:**

- Errors are invisible in return types — `Promise<GamePass>` does not indicate
  that `RateLimitError` is possible
- Callers can forget to catch; TypeScript does not enforce it
- No type narrowing for specific error subtypes without `instanceof` inside a
  `catch` block
- Hidden control flow makes it hard to reason about what a call can return

### Either Monads (fp-ts / Effect style)

Use `Either<E, A>` or `Effect<A, E>` from a functional programming library.

**Pros**: composable with `pipe`, `chain`, `map`; well-established in FP
communities; `Effect` adds structured concurrency.

**Rejected because:**

- Both fp-ts and Effect are runtime dependencies — violates the zero-dependency
  constraint (ADR-008)
- Steep learning curve; incompatible with ADR-001's accessibility goal
- `pipe`/`chain` patterns are unfamiliar to contributors without FP background
- Effect's full model (fibers, layers, services) is significant overhead for an
  HTTP client library

### Tuple Returns `[error, data]` (Go style)

Return `[OpenCloudError | null, T | null]` — caller destructures and checks the
error position.

**Pros**: simple, no new types, idiomatic in some JS codebases, zero overhead.

**Rejected because:**

- No type narrowing: after checking `if (error)`, TypeScript still types `data`
  as `T | null` — caller must assert or use non-null assertion
- Easy to ignore: `const [, data] = await client.create(...)` silently discards
  the error
- Less expressive than a named discriminated union (`result.success`,
  `result.data`, `result.err` are self-documenting)

## Implementation Notes

- `Result` type defined in `packages/open-cloud/src/types.ts`
- Exported from package root (`src/index.ts`) for consumer use
- Internal HTTP client also returns `Result` — the pattern is used consistently
  at all layers within the package
- `tryCatch` helper wraps async operations that may throw (e.g., `fetch`),
  converting exceptions to `Result` at the lowest level

## Related Decisions

- ADR-001: TypeScript with Bun — TypeScript-first principle supports type-safe
  error handling
- ADR-002: FCIS Architecture — SDK is consumed by shell layer; Result types
  propagate cleanly across the boundary
- ADR-003: Testing strategy — Result types make error paths explicit and easier
  to test with 100% branch coverage
- ADR-007: Open Cloud only — all SDK errors model Open Cloud API failure modes
- ADR-008: Zero runtime dependencies — ruled out fp-ts and Effect, driving the
  discriminated union implementation

## References

- [Discriminated Unions (TypeScript Handbook)](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions)
- [Open Cloud Package Design Plan](../plans/2025-12-13-open-cloud-package-design.md)
- [fp-ts Either](https://gcanti.github.io/fp-ts/modules/Either.ts.html)
- [Effect](https://effect.website/)
