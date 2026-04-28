# ADR-001: TypeScript with Bun Runtime for CLI Tool

Date: 2025-12-06 Status: Accepted

Decision Makers: Maintainer Tags: infrastructure, tooling, cli, typescript, bun

## Context

Bedrock is Roblox deployment CLI replacing Mantle (Rust-based). Must serve both
roblox-ts and Luau developers.

Requirements:

- Distribute via npm (users with runtime) AND compiled binaries (Rokit/Foreman)
- Maintainer proficient in TypeScript, not Rust
- Fast startup for CLI use case
- Reasonable binary size
- Low contribution barrier for Roblox community

Current state: Starting new project, no existing codebase constraints.

## Decision

Use **TypeScript** with **Bun runtime** for implementation.

Distribution strategy:

- npm package for users with Bun/Node installed
- Compiled binary for Rokit/Foreman users
- Package manager: pnpm (workspace management, proven ecosystem)

## Consequences

### Positive

- 4x faster startup than Node.js (<1ms vs 20-30ms) - critical for CLI
  responsiveness
- 45% smaller binaries than Node.js (57 MB vs 104 MB)
- TypeScript familiarity lowers contribution barrier vs Rust
- Dual distribution pattern proven (esbuild, Biome use same approach)
- npm ecosystem compatibility maintained
- Bun production-ready since v1.0 (Sept 2023)

### Negative

- 5-6x larger binaries than Rust (57 MB vs 5-10 MB)
- Bun less battle-tested than Node.js (newer runtime, potential edge cases)
- Runtime dependency for npm distribution (users need Bun/Node)
- pnpm adds complexity vs Bun's native package manager

### Neutral

- Must maintain dual distribution (npm + binary)
- Binary updates require republishing to Rokit/Foreman registries
- TypeScript compilation step in build process

## Alternatives Considered

### Rust (like Mantle)

**Pros**: Smallest binaries (5-10 MB), fastest execution, proven with Mantle.

**Rejected**: Maintainer unfamiliar with Rust. Higher contribution barrier.
Binary size less critical than development velocity and community contributions.

### Node.js Runtime

**Pros**: Most mature JavaScript runtime, widest adoption, extensive tooling.

**Rejected**: Slower startup (20-30ms) impacts CLI UX. Larger binaries (104 MB).
Bun offers measurable advantages without significant downside.

### Deno

**Pros**: TypeScript-native (no compilation), good security model, single
executable compilation.

**Rejected**: Different ecosystem with less npm compatibility. Roblox tooling
ecosystem heavily npm-based. Migration path for existing tools harder.

### Go

**Pros**: Small binaries, fast startup, excellent CLI ecosystem (Cobra, etc).

**Rejected**: Different language requiring learning curve. TypeScript
familiarity preferred for maintainability and contributions from roblox-ts
community.

## Implementation Notes

- Use Bun's `bun build --compile` for binary generation
- pnpm workspaces if monorepo structure needed
- Target: Bun 1.x stable
- Binary distribution: GitHub Releases + Rokit/Foreman registries
- npm distribution: `@bedrock/cli` package

## Related Decisions

- Future: May need ADR for monorepo structure if project grows
- Future: May need ADR for plugin architecture if extensibility required

## References

- [Bun Runtime Documentation](https://bun.sh/docs)
- [Bun Binary Compilation](https://bun.sh/docs/bundler/executables)
- Verified: Rokit/Foreman support non-Rust binaries
- Benchmark: Bun binary = 57 MB, Node.js SEA = 104 MB (tested)
- Pattern: esbuild and Biome use dual npm + binary distribution

## Amendment 2026-04-28: Runtime contract vs binary host

The original Decision conflated two roles for Bun: the runtime (which APIs
shipped code may call) and the binary host (the executable wrapper for
Rokit/Aftman/Foreman distribution). Bedrock has separated them in practice
since ADR-014 moved dev tooling to Vite+ (Node-based). Library code under
`packages/*/src/` calls no Bun-specific APIs; the only `Bun.*` calls in the
repo are in build-time scripts.

The framing narrows:

- **Runtime contract for shipped library code**: Node 24.12+ or Bun 1.3+.
  Both runtimes declared in `engines`. Source uses only standard web APIs.
  Capability gaps Node has but Bun ships natively (e.g. YAML parsing) are
  filled by runtime dependencies that work on both, such as `confbox`.
- **Binary host**: `bun build --compile --minify` wraps the `vp pack` output
  (`dist/cli/run.mjs`) as a self-contained executable. Bun is the wrapper,
  not the runtime contract.
- **Dev tooling**: Vite+ for build, test, and task orchestration (ADR-014).
  Bun runs ad-hoc workspace scripts. Dev tooling has no runtime contract
  obligation.

### Empirical re-validation

A spike against the current CLI bundle on macOS arm64 (2026-04-28).
Startup is measured as the compiled binary cold-starting and returning from
`--help`, not the bare runtime startup quoted earlier in this ADR:

| Technique                      | Binary size | Cold startup (median of 5) |
| ------------------------------ | ----------- | -------------------------- |
| `bun build --compile --minify` | 62 MB       | 491 ms                     |
| `@yao-pkg/pkg`                 | 67 MB       | 471 ms                     |
| Node 24 SEA                    | 120 MB      | 501 ms                     |
| Node 25 SEA                    | 133 MB      | 563 ms                     |

Bun's 2x lead over SEA from the original spike held; Node 25 regressed SEA
further. `@yao-pkg/pkg` matched Bun's size class, but it is the community
fork after Vercel archived `vercel/pkg` in 2024, and pkg cannot bundle
workspace ESM without a Bun-produced CJS pre-bundle. Bun wins on both size
and pipeline simplicity. Wiring the binary release into CI (with the
mandatory `codesign -s -` step on macOS arm64) is tracked as follow-up work.

### Related

- **ADR-014** moved dev tooling to Node-based Vite+. This amendment names
  the runtime contract ADR-014 left implicit.
