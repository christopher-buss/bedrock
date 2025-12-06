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
