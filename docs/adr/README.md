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
