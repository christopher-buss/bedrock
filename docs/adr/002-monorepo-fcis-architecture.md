# ADR-002: Monorepo with Turborepo and FCIS + Ports Architecture

Date: 2025-12-06 Status: Accepted

Refined by: ADR-011 (library/SDK packages use a simplified architecture)
Partially superseded by: ADR-014 (Turborepo is replaced by Vite+ as the task
runner; the monorepo layout and FCIS + Ports architecture remain in effect)

Decision Makers: Maintainer Tags: architecture, monorepo, turborepo, fcis,
testing, modularity

## Context

Bedrock is TypeScript CLI for Roblox deployment. Requirements:

- **Testability**: Unit, integration, e2e at every layer
- **Flexibility**: Swap state backends (GitHub Gist → S3 → Cloudflare R2)
- **Clarity**: Contributors know where code belongs
- **Multi-package**: Open Cloud API client, CLI tool, docs website
- **Maintainability**: Clear boundaries prevent architectural drift

Current state: Single package structure, planning multi-package growth.

Constraints:

- Must support swappable backends without rewrites
- Core logic must be testable without mocks
- Open Cloud client should be standalone package

## Decision

Use **Turborepo monorepo** with **Functional Core, Imperative Shell (FCIS) +
Ports** architecture.

### Monorepo Structure

```text
bedrock/
├── apps/
│   └── website/              # Vitepress docs
├── packages/
│   ├── open-cloud/           # @bedrock/open-cloud
│   └── cli/                  # bedrock CLI
├── docs/                     # Internal docs (ADRs, plans)
├── turbo.json
└── pnpm-workspace.yaml
```

### Internal Architecture (CLI package)

```text
packages/cli/src/
├── core/         # Pure functions (no I/O, business logic)
├── shell/        # Commands (I/O orchestration)
├── ports/        # Interfaces for swappable backends
├── adapters/     # Port implementations (GistBackend, S3Backend)
└── types/        # Shared TypeScript types
```

**FCIS + Ports Pattern:**

- **Core**: Pure functions, deterministic, zero I/O, easily tested
- **Shell**: Calls core functions, handles I/O (file reads, API calls)
- **Ports**: Interfaces defining contracts (StateBackend, RobloxApiClient)
- **Adapters**: Concrete implementations of ports (GistBackend, etc.)

## Consequences

### Positive

- **Zero-mock testing**: Core logic tested with pure function calls (no mocking)
- **Clear I/O boundaries**: Shell does I/O, core is pure - never confused
- **Trivial backend swaps**: Implement port interface, swap adapter
- **Contributor clarity**: Folder structure answers "where does this code go?"
- **Standalone packages**: `@bedrock/open-cloud` usable independently
- **Incremental builds**: Turborepo caches, parallelizes builds
- **Package isolation**: Changes in CLI don't affect Open Cloud client

### Negative

- **More folders**: Slightly more structure than flat layout
- **Learning curve**: Team must understand FCIS (though concept is simple)
- **Monorepo tooling**: Adds Turborepo config, workspace management
- **Port boilerplate**: Every adapter must implement port interface

### Neutral

- **Workspace management**: pnpm workspaces + Turborepo config required
- **Cross-package dependencies**: Must manage `@bedrock/open-cloud` versioning
- **Build orchestration**: Turborepo handles task ordering

## Alternatives Considered

### Single Package (No Monorepo)

**Pros**: Simpler setup, no workspace config, fewer build steps.

**Rejected**: Known requirement for multiple packages (Open Cloud client, CLI,
docs). Migration to monorepo later is painful. Better to start with structure
that supports growth.

### Layered Architecture + Dependency Injection

**Pros**: Familiar to enterprise developers, proven pattern (controllers →
services → repositories).

**Rejected**: Requires DI container, every test needs mocks, more boilerplate.
FCIS achieves better testability with less ceremony for CLI scope.

**Why not this**: CLI tools benefit from pure functional core more than layered
services. DI overhead not justified when ports + adapters give same flexibility.

### Hexagonal Architecture (Full)

**Pros**: Excellent flexibility, domain logic isolated from infrastructure,
proven pattern.

**Rejected**: More ceremony than needed for CLI scope (application services
layer, domain layer, extensive port definitions). FCIS + Ports provides same
benefits (swappable backends, testability) with less overhead.

**Why not this**: Bedrock is CLI tool, not business domain application. Full
hexagonal adds layers (application services, domain models) that don't map to
CLI use case. FCIS simplified hexagonal for functional-first codebase.

### Feature-Based Folders (No Formal Architecture)

**Pros**: Simple, fast to start, intuitive grouping (`deploy/`, `plan/`,
`apply/`).

**Rejected**: Poor testability (I/O mixed with logic), boundaries blur over time
(where does shared logic go?). Doesn't meet testability requirements. Experience
shows this degrades into spaghetti for CLI tools over time.

**Why not this**: Tested deployment tools in production. Feature folders lead to
I/O mixed with logic, making unit tests require mocks. Boundaries erode as
codebase grows.

## Implementation Notes

### Turborepo Configuration

- `turbo.json` defines task pipelines (`build`, `test`, `lint`)
- Caching for all tasks
- Parallel execution where dependencies allow

### FCIS Guidelines

**Core rules:**

- No imports from Node.js I/O modules (`fs`, `http`, etc.)
- Functions take data, return data
- Side effects forbidden (no logging, no mutations)

**Shell rules:**

- Orchestrates I/O (read files, call APIs)
- Calls core functions for business logic
- Handles errors, logging, CLI output

**Port interface example:**

```typescript
// ports/StateBackend.ts
export interface StateBackend {
	read(): Promise<null | State>;
	write(state: State): Promise<void>;
}

// adapters/GistBackend.ts
export class GistBackend implements StateBackend {
	public async read(): Promise<null | State> {
		/* ... */
	}

	public async write(state: State): Promise<void> {
		/* ... */
	}
}
```

### Package Boundaries

- `@bedrock/open-cloud`: Zero dependencies on CLI
- `bedrock` (CLI): Depends on `@bedrock/open-cloud`
- `website`: No code dependencies, imports examples for docs

## Related Decisions

- ADR-001: TypeScript with Bun - informs monorepo tooling choices
- Future: Plugin architecture (if needed) will use ports pattern
- Future: Additional state backends (S3, R2) will implement StateBackend port

## References

- [Functional Core, Imperative Shell](https://www.destroyallsoftware.com/screencasts/catalog/functional-core-imperative-shell) -
  Gary Bernhardt
- [Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/) -
  Alistair Cockburn
- [Turborepo Documentation](https://turbo.build/repo/docs)
- [pnpm Workspaces](https://pnpm.io/workspaces)
- Pattern tested in production CLI tools (Terraform, Pulumi use similar
  port-adapter patterns)
