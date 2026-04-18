# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for Bedrock.

ADRs document significant architectural decisions, the context in which they
were made, and their consequences. They serve as a historical record of why
things are the way they are.

## Index

| ADR                                        | Title                                                 | Status   | Date       |
| ------------------------------------------ | ----------------------------------------------------- | -------- | ---------- |
| [001](./001-typescript-bun-runtime.md)     | TypeScript with Bun Runtime                           | Accepted | 2025-12-06 |
| [002](./002-monorepo-fcis-architecture.md) | Monorepo with Turborepo and FCIS + Ports Architecture | Accepted | 2025-12-06 |
| [003](./003-testing-strategy.md)           | Testing Strategy                                      | Accepted | 2025-12-06 |
| [004](./004-documentation-site.md)         | Documentation Site                                    | Accepted | 2025-12-12 |
| [005](./005-jsdoc-example-testing.md)      | Tested JSDoc Examples                                 | Accepted | 2025-12-13 |
| [006](./006-adr-enforcement.md)            | ADR Enforcement                                       | Accepted | 2025-12-13 |
| [007](./007-open-cloud-only.md)            | Open Cloud APIs Only                                  | Accepted | 2025-12-13 |
| [008](./008-zero-runtime-dependencies.md)    | Zero Runtime Dependencies in `@bedrock/open-cloud`    | Accepted | 2026-04-12 |
| [009](./009-result-types-over-exceptions.md) | Result Types Over Exceptions in `@bedrock/open-cloud` | Accepted | 2026-04-12 |
| [010](./010-sdk-managed-rate-limiting-and-retry.md) | SDK-Managed Rate Limiting and Retry in `@bedrock/open-cloud` | Accepted | 2026-04-12 |
| [011](./011-simplified-architecture-for-library-packages.md) | Simplified Architecture for Library Packages | Accepted | 2026-04-12 |
| [012](./012-class-based-clients-with-per-request-overrides.md) | Class-Based Clients with Per-Request Config Overrides | Accepted | 2026-04-12 |
| [013](./013-hk-git-hook-manager-with-differentiated-gating.md) | hk for Git Hook Management with AI-vs-Human Differentiated Gating | Accepted | 2026-04-13 |
| [014](./014-vite-plus-unified-toolchain.md) | Vite+ as Unified Build, Test, and Task Toolchain | Accepted | 2026-04-15 |
| [015](./015-mutation-testing-stryker.md) | Mutation Testing with StrykerJS | Accepted | 2026-04-16 |
| [016](./016-knip-unused-code-detection.md) | Knip for Workspace-Level Unused Code Detection | Accepted | 2026-04-17 |
| [017](./017-product-framing-programmatic-iac-with-cli.md) | Product Framing: Programmatic IaC with CLI Convenience (Level 2 Hybrid) | Accepted | 2026-04-17 |
| [018](./018-fcis-ports-with-primary-driven-distinction.md) | Architecture Refinement: FCIS + Ports with Explicit Primary/Driven Port Distinction | Accepted | 2026-04-17 |
| [019](./019-state-data-model-and-diff-algebra.md) | State Data Model and Diff Algebra (Mantle Parity) | Accepted | 2026-04-17 |

## Creating a New ADR

1. Use the `adr` agent to walk through the decision properly
2. Number sequentially (e.g., `001-feature-name.md`)
3. Fill in all sections
4. Add it to the index above
5. Submit a PR for review

## Statuses

- **Proposed**: Under discussion
- **Accepted**: Decision made and in effect
- **Deprecated**: No longer applies
- **Superseded**: Replaced by a newer ADR
