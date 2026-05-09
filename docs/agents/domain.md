# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root — points at one `CONTEXT.md` per package context. Read each one relevant to the topic.
- **Per-package `CONTEXT.md`** at `packages/<pkg>/CONTEXT.md` — domain language scoped to that package.
- **`docs/adr/`** at the repo root — system-wide architectural decisions that apply across packages.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The producer skill (`/grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

## File structure

This repo is a **multi-context monorepo**:

```text
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← system-wide decisions (ADR-001 through ADR-020)
└── packages/
    ├── open-cloud/
    │   └── CONTEXT.md                 ← @bedrock-rbx/ocale vocabulary
    ├── bedrock/
    │   └── CONTEXT.md                 ← @bedrock-rbx/core vocabulary (when written)
    ├── testing/
    │   └── CONTEXT.md                 ← @bedrock-rbx/testing vocabulary (when written)
    ├── vite-config/                   ← config-only, no domain language
    └── typescript-config/             ← config-only, no domain language
```

Per-package ADR directories (`packages/<pkg>/docs/adr/`) are not used. All ADRs live at the repo root.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant package's `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-007 (Open Cloud only) — but worth reopening because…_
