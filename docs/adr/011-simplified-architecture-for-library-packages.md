# ADR-011: Simplified Architecture for Library Packages

**Date:** 2026-04-12 **Status:** Approved

**Refines:** ADR-002 (library/SDK packages only)

Decision Makers: Maintainer Tags: architecture, fcis, open-cloud, libraries,
monorepo

## Context

ADR-002 established Functional Core, Imperative Shell (FCIS) + Ports as the
architecture for the Bedrock monorepo. Its "Internal Architecture" section
described the CLI package, but its monorepo diagram placed `packages/open-cloud/`
alongside `packages/cli/` under the same umbrella without distinguishing them.
Readers reasonably concluded FCIS + Ports applied to every package.

Building `@bedrock/open-cloud` revealed that conclusion is wrong for HTTP client
libraries. FCIS exists to separate pure business logic from I/O so the logic can
be tested without mocks. An HTTP client library has no pure business logic to
separate — the package *is* the I/O layer for something else. Its only "pure"
code is request builders and response parsers, which are already pure in any
reasonable implementation. Forcing FCIS vocabulary onto such a package produces
"Ports" with exactly one implementation, which is ceremony rather than
architecture.

The `@bedrock/open-cloud` package was restructured to use the simplified
pattern in commit `fa173bc`. This ADR catches the decision log up to what
already exists on disk and establishes a general rule so future packages can
make the same determination consistently.

External precedent reinforces the carve-out.
[Scenarist](https://github.com/citypaul/scenarist), a TypeScript library of
comparable shape, codifies the same decision in its ADR-0006 ("Thin adapters -
real integration tests"). Scenarist uses real ports and adapters — but only for
*inbound* framework boundaries (Express vs Next.js), never for outbound HTTP to
specific vendor APIs. There is no `StripePort` in their codebase: outbound HTTP
to one specific vendor has no second implementation, so the abstraction would
be imaginary.

Constraints:

- ADR-002 remains the correct decision for the CLI application and for any
  package with pluggable backends or business logic separable from I/O.
- The simplified pattern must not undermine ADR-003's testability requirements
  (100% coverage, no mocks in pure function tests).
- Contributors need a mechanical rule — "library vs app" is too fuzzy to apply
  without argument.

## Decision

A Bedrock package may use a **simplified architecture** in place of FCIS +
Ports when **all five** of the following criteria hold. If any criterion fails,
ADR-002 (FCIS + Ports) applies as the default.

### Opt-out criteria

1. **Single responsibility** — the package does one thing describable in a
   sentence (e.g., "typed client for Roblox Open Cloud APIs").
2. **Minimal translation logic** — requests and responses are mostly direct
   pass-through. Building a JSON body and parsing a JSON response counts as
   pass-through; significant normalization, validation, or business rules does
   not.
3. **Stable external contract** — there is only one real implementation target
   (one vendor API, one protocol version), not a pluggable category like "state
   backend" or "config source."
4. **No meaningful pure core to separate** — if I/O were removed from the
   package, there would be nothing substantive left beyond request builders and
   response parsers, which are already pure in the simplified pattern.
5. **Swappability is imaginary** — any hypothetical "second adapter" would
   either never be written, or would be a test fake. Test fakes are better
   served by injecting a fake at the HTTP seam than by inventing a Port for it.

The rubric is adapted from scenarist's ADR-0006 and narrowed to this project's
concerns. The five criteria are conjunctive by design: defaulting to FCIS when
any criterion is ambiguous preserves ADR-002 as the load-bearing decision.

### Principles of the simplified pattern

When a package opts out, it must still adhere to the following principles.
Folder layout is the package's own concern and is not prescribed by this ADR.

- **Pure request builders** — request construction is a pure function from
  parameters to an HTTP request value. Testable without any I/O.
- **Pure response parsers** — response interpretation is a pure function from
  raw response to typed value or error. Testable without any I/O.
- **Immutable configuration** — once the package exposes a usable handle to a
  consumer, the configuration backing that handle does not change underneath
  them. No hidden mutable state across calls.
- **Result types at method boundaries** — public methods return
  `Promise<Result<T, E>>` per ADR-009. Errors are never thrown across the
  package boundary.
- **Testable HTTP seam** — the HTTP client is an injected dependency so tests
  can supply a fake. The seam is the HTTP interface, not a domain-shaped Port.
- **Public surface separation** — exported types and classes live under a
  clearly named directory; internal utilities are not exported and cannot be
  imported by consumers.

### Application today

- **`@bedrock/open-cloud`** — satisfies all five criteria; uses the simplified
  pattern. The package's folder layout (`resources/`, `internal/`, `errors/`,
  `client/`) is a package-level concern; see the package source for current
  structure.
- **`@bedrock/cli` (planned)** — fails criteria 2, 3, 4, and 5 (substantive
  deployment logic and validation, pluggable state backends, business logic
  separable from I/O, real swappability across Gist/S3/R2); uses FCIS + Ports
  per ADR-002.

## Consequences

### Positive

- **No ceremony without payoff** — HTTP clients do not grow Port interfaces
  that have exactly one implementation.
- **Mechanical decision rule** — new packages run the five criteria and get a
  clear answer, rather than arguing "is this a library?"
- **Matches industry conventions** — aligns `@bedrock/open-cloud` with the
  structure of AWS SDK v3, OpenAI SDK, and other modern TypeScript SDKs,
  lowering the learning curve for external contributors.
- **Preserves FCIS where it helps** — ADR-002 remains the default, so packages
  with real business logic still get the zero-mock testability benefits it was
  introduced for.
- **Testability is preserved** — the testable HTTP seam, pure builders, and
  pure parsers together give the simplified pattern the same mock-free unit
  testing story FCIS provides, just without the port vocabulary.

### Negative

- **Two patterns in one monorepo** — contributors must learn when each applies
  and how to apply the five-criteria check.
- **Risk of misapplication** — a contributor might force the simplified
  pattern onto a package that genuinely needs FCIS. Mitigated by the
  "all five must hold" rule, which biases toward FCIS in ambiguous cases.
- **Generalization from one package** — the pattern is currently validated by
  a single package (`@bedrock/open-cloud`). Future library packages may reveal
  additional considerations that require revisiting this ADR.

### Neutral

- Shared constraints (ADR-003 testing strategy, ADR-009 Result types) apply to
  both patterns uniformly.
- Folder layout is not prescribed by this ADR. Each opting-out package is
  responsible for its own structure.

## Alternatives Considered

### Keep FCIS + Ports universal (status quo as written in ADR-002)

**Rejected.** Forces HTTP clients to define Ports with exactly one
implementation. The "adapter" would never be swapped because outbound HTTP to a
specific vendor API has no second target. Ceremony without a testability or
flexibility benefit.

### Two coequal top-level architectures with no default

Treat FCIS and the simplified pattern as peer options and let each package
choose.

**Rejected.** Makes ADR-002's status ambiguous — it would no longer be the
default, just one of two options. Removes the safety rail that ambiguous cases
fall back to the more rigorous pattern. Harder for contributors to pick the
right tool without a decision rule.

### Full supersession of ADR-002

Mark ADR-002 as Superseded and write ADR-011 as a replacement covering both
patterns.

**Rejected.** ADR-002's decision still stands for everything it was actually
applied to (the CLI and its pluggable backends). Superseding it would
mischaracterize what happened: the decision was not reversed, only narrowed.
The append-only ADR convention (Nygard, MADR) reserves "Superseded" for
replacement, not refinement.

### Do nothing; leave the implicit divergence

The package is already restructured to the simplified pattern; arguably no
ADR is needed.

**Rejected.** ADR-002's prose and diagrams still describe a monorepo where
every package uses FCIS + Ports, which no longer matches reality. Leaving the
gap makes ADR-002 misleading, prevents future packages from applying the same
reasoning consistently, and violates ADR-006 (ADR enforcement) which requires
architectural changes to be recorded before implementation — this ADR closes
that gap retroactively.

## Implementation Notes

- **ADR-002 cross-reference.** A single header line is added to ADR-002
  (`Refined by: ADR-011 (library/SDK packages use a simplified architecture)`)
  to give readers encountering ADR-002 first a breadcrumb to this refinement.
  ADR-002's Context, Decision, and Consequences are not modified. The
  mainstream ADR convention is append-only; this header line is the minimal
  additive edit required for discoverability.
- **Folder layout** is deliberately not prescribed by this ADR. Each opting-out
  package is responsible for documenting its own layout alongside its source
  (package README, code organization). This ADR governs the decision rule and
  the principles, not the directory structure.
- **Future library packages** must include an explicit five-criteria check in
  their pull request description or package README when opting out of FCIS, and
  reference this ADR.

## Related Decisions

- **ADR-002**: Monorepo with FCIS + Ports — the decision this ADR refines.
  FCIS + Ports remains the default for the monorepo; this ADR carves out
  library packages that satisfy all five criteria.
- **ADR-003**: Testing strategy — applies to both patterns unchanged. The
  simplified pattern preserves mock-free unit testing via pure builders/parsers
  and the injectable HTTP seam.
- **ADR-006**: ADR enforcement — this ADR is the retroactive record required
  by ADR-006 for the simplified-architecture decision already implemented in
  `@bedrock/open-cloud`.
- **ADR-008**: Zero runtime dependencies — scoped to `@bedrock/open-cloud` and
  compatible with the simplified pattern.
- **ADR-009**: Result types over exceptions — required at method boundaries in
  the simplified pattern as well as in FCIS code.
- **ADR-010**: SDK-managed rate limiting and retry — scoped to
  `@bedrock/open-cloud` and implemented within the simplified pattern.

## References

- [Scenarist ADR-0006: Thin adapters - real integration tests](https://github.com/citypaul/scenarist/blob/main/docs/adrs/0006-thin-adapters-real-integration-tests.md) —
  precedent and source of the five-criteria rubric
- [Scenarist ADR-0011: Domain constants location](https://github.com/citypaul/scenarist/blob/main/docs/adrs/0011-domain-constants-location.md) —
  explicit rule for what belongs in core vs adapter
- [Michael Nygard, "Documenting Architecture Decisions" (2011)](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions) —
  source of the append-only ADR convention
- [MADR template](https://github.com/adr/madr) — canonical status vocabulary
- [AWS SDK v3 architecture](https://github.com/aws/aws-sdk-js-v3) — industry
  example of a TypeScript SDK without a FCIS-style core
- [OpenAI Node.js SDK](https://github.com/openai/openai-node) — Stainless-style
  client pattern common in modern TypeScript SDKs
