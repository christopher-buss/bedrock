# ADR-008: Zero Runtime Dependencies in `@bedrock-rbx/ocale`

**Date:** 2026-04-12 **Status:** Accepted

Decision Makers: Maintainer Tags: dependencies, open-cloud, security,
supply-chain, web-apis

## Context

`@bedrock-rbx/ocale` is a standalone, publishable TypeScript HTTP client for
Roblox Open Cloud APIs.

The package targets Node.js 24.12+ and Bun 1.3+. Both runtimes ship native
implementations of `fetch()`, `FormData`, `Uint8Array`, `TextEncoder`, and
`TextDecoder` — the complete set of APIs required to build an HTTP client with
multipart upload support. The hard capability gap that historically forced a
`form-data` dependency (absent native `FormData` in Node.js) was closed in
Node.js 18 (unflagged in 21+, stable in 24 LTS). There is simply no remaining
functional requirement that demands a runtime dependency.

Given that, three approaches were evaluated:

1. **Zero runtime dependencies** — use only standard web APIs built into the
   runtime
2. **Minimal dependencies** — use targeted packages (e.g., `undici`,
   `form-data`) for specific capabilities
3. **Full HTTP framework** — use an established HTTP client library (e.g., `got`,
   `axios`, `ky`)

As a library distributed via npm, the dependency graph is inherited by every
consumer — including CI/CD pipelines with elevated credentials. When no
dependency is functionally required, adding one introduces supply chain risk
with no offsetting benefit.

## Decision

`@bedrock-rbx/ocale` ships with **`"dependencies": {}`** — literally empty.

All runtime functionality uses standard web APIs exclusively:

- `fetch()` — HTTP requests
- `FormData` — multipart/form-data encoding
- `Uint8Array` — binary file data (not Node.js `Buffer`)
- `TextEncoder` / `TextDecoder` — text encoding for multipart headers

Multipart encoding uses the native `FormData` API. No `form-data` package. No
`undici`. No `got`, `axios`, or `ky`.

No Bun-specific APIs are used, ensuring compatibility with both target runtimes
from the same source.

devDependencies remain: `@bedrock-rbx/typescript-config`, `@bedrock-rbx/vitest-config`,
`@types/bun`, `tsdown`, `typescript`, `vitest`. These are build/test tooling
only — not shipped to consumers.

## Consequences

### Positive

- **Eliminated supply chain attack surface**: zero transitive runtime
  dependencies means zero vectors for compromised packages to execute code in
  consumer environments
- **Faster security audits**: reviewers only need to audit SDK source code — no
  transitive dependency tree to trace
- **Instant installs**: no dependency resolution, no hoisting conflicts, no
  version range negotiation
- **No version drift**: no runtime packages to update, audit, or patch
- **Small bundle**: minimal import (errors + types) targets < 1KB gzipped; no
  library code inflates the bundle
- **Stable API surface**: web platform APIs (fetch, FormData) are versioned by
  the runtime, not by npm release cycles

### Negative

- **Hand-rolling ordinarily-dependency-provided logic**: multipart encoding,
  the rate-limit queue (ADR-010), exponential backoff, and low-level HTTP
  handling must all be implemented from scratch within the package. Each is
  well-scoped, but each is also code to write, test, and maintain that a
  mature HTTP framework would have provided pre-tested. The subset of Open
  Cloud APIs this SDK targets keeps the scope manageable, but "manageable"
  is not "free."
- **Full test burden for primitives**: ADR-003 requires 100% coverage on
  everything that ships, including the hand-rolled HTTP utilities. Edge
  cases (retry timing, timeout handling, multipart encoding quirks,
  `Retry-After` header parsing) that a framework would cover in its own
  tests become the SDK's responsibility to test exhaustively.
- **Discovery cost for HTTP edge cases**: frameworks like `got` or `ky`
  have accumulated workarounds for HTTP edge cases over years of production
  use (redirect handling, proxy support, header casing quirks, chunked
  encoding interactions). A zero-dependency HTTP client will meet those
  edge cases later, the hard way, and fix them in-tree. This is acceptable
  for a SDK bound to a single vendor's well-documented API surface, but it
  trades upfront dependency risk for long-tail maintenance risk.

### Neutral

- The `form-data` package and `undici` are devDependencies in many projects
  anyway; removing them from the runtime graph does not affect developer
  tooling
- Result types (ADR-009) were already preferred on their own merits; the
  zero-dep constraint reinforced that choice by ruling out fp-ts and Effect

## Alternatives Considered

### Minimal Dependencies (undici, form-data)

Use `undici` for HTTP and `form-data` for multipart encoding — the packages that
Node.js itself uses internally.

**Pros**: battle-tested implementations, no hand-rolling, handles edge cases
automatically.

**Rejected because:**

- Adds transitive dependencies to every consumer's install; `undici` alone
  brings a non-trivial dependency subtree
- Native `fetch()` and `FormData` are available on all target runtimes — there
  is no functional gap to fill
- Supply chain risk scales with number of transitive packages; the benefit does
  not justify the risk for this use case
- `form-data` specifically exists to polyfill `FormData` in older Node.js
  versions — unnecessary at Node.js 24.12+

### Full HTTP Framework (got / axios / ky)

Use an established HTTP client library that provides retries, timeouts,
interceptors, and streaming out of the box.

**Pros**: feature-complete, well-documented, widely used, handles many edge
cases.

**Rejected because:**

- All three are runtime dependencies with their own transitive graphs (`got`
  brings `p-cancelable`, `cacheable-request`, etc.)
- The SDK's required feature set (fetch, multipart upload, retry, rate limiting)
  is modest and well-scoped — an HTTP framework is significant overhead
- Framework APIs diverge from the standard web platform; the SDK would expose
  framework-specific types or require an internal adapter layer
- Framework version churn (axios 0.x → 1.x, got 11 → 12 → 13) would force
  breaking changes or major dependency maintenance work
- Supply chain risk is not theoretical: on 2026-03-31, axios was compromised
  when an attacker social-engineered a maintainer's npm credentials and
  published backdoored versions (`1.14.1`, `0.30.4`) containing a cross-platform
  RAT dropper. The ~3-hour exposure window affected a package with ~100M weekly
  downloads. Zero runtime dependencies eliminates this class of risk entirely.

## Implementation Notes

- `packages/open-cloud/src/internal/http/fetch-client.ts` — HTTP implementation
  using native `fetch()`
- `packages/open-cloud/src/internal/http/multipart.ts` — multipart encoding
  using native `FormData`
- `Uint8Array` used for binary file data throughout (not Node.js `Buffer`) to
  stay on the web platform API
- The `engines` field in `package.json` enforces the runtime floor:
  `"node": ">=24.12.0"`, `"bun": ">=1.3.0"`

## Related Decisions

- ADR-001: TypeScript with Bun — establishes Bun as primary runtime; Node.js
  compatibility is a secondary requirement this ADR formalises
- ADR-002: FCIS Architecture — SDK is the I/O layer for Bedrock CLI; zero deps
  keeps the I/O boundary clean and auditable
- ADR-003: Testing strategy — 100% coverage requirement applies to HTTP
  utilities
- ADR-007: Open Cloud only — all HTTP traffic goes to Roblox's Open Cloud API;
  the request shape is well-defined, no general-purpose HTTP framework needed
- ADR-009: Result types over exceptions — Result types were preferred
  independently; zero deps reinforced the choice by ruling out fp-ts and Effect

## References

- [Open Cloud Package Design Plan](../plans/2025-12-13-open-cloud-package-design.md)
- [Node.js 21: Stable fetch()](https://nodejs.org/en/blog/announcements/v21-release-announce)
- [WHATWG Fetch Standard](https://fetch.spec.whatwg.org/)
- [WHATWG Encoding Standard (TextEncoder)](https://encoding.spec.whatwg.org/)
- [undici (Node.js internal HTTP)](https://github.com/nodejs/undici)
- [OpenSSF Supply Chain Security](https://openssf.org/blog/2022/09/01/npm-best-practices-for-the-supply-chain/)
- [Axios npm Supply Chain Compromise (2026-03-31)](https://snyk.io/blog/axios-npm-package-compromised-supply-chain-attack-delivers-cross-platform/)
