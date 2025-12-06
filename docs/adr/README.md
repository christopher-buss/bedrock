# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for Bedrock.

ADRs document significant architectural decisions, the context in which they
were made, and their consequences. They serve as a historical record of why
things are the way they are.

## Index

| ADR                                 | Title                                 | Status   | Date       |
| ----------------------------------- | ------------------------------------- | -------- | ---------- |
| [001](./001-typescript-language.md) | TypeScript as Implementation Language | Accepted | 2025-12-06 |
| [002](./002-open-cloud-only.md)     | Open Cloud APIs Only                  | Accepted | 2025-12-06 |
| [003](./003-github-gists-state.md)  | GitHub Gists for State Storage        | Accepted | 2025-12-06 |
| [004](./004-multi-format-config.md) | Multi-Format Configuration            | Accepted | 2025-12-06 |

## Creating a New ADR

1. Copy the template from `docs/templates/adr.md`
2. Number it sequentially (e.g., `005-feature-name.md`)
3. Fill in all sections
4. Add it to the index above
5. Submit a PR for review

## Statuses

- **Proposed**: Under discussion
- **Accepted**: Decision made and in effect
- **Deprecated**: No longer applies
- **Superseded**: Replaced by a newer ADR
