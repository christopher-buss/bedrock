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
| [013](./013-hk-git-hook-manager-with-differentiated-gating.md) | hk for Git Hook Management with AI-vs-Human Differentiated Gating | Proposed | 2026-04-13 |

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
