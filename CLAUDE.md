# Bedrock Project Context

## What is Bedrock?

Infrastructure-as-Code deployment tool for Roblox, written in TypeScript. Modern
replacement for [Mantle](https://github.com/blake-mealey/mantle) (Rust-based
tool no longer maintained).

## Architecture

- **Language**: TypeScript (ES modules)
- **Runtime**: Bun
- **Config**: c12-based multi-format support (TS, JS, YAML, JSON)
- **State**: GitHub Gists (default), extensible backends
- **Auth**: Roblox Open Cloud APIs only (no ROBLOSECURITY)
- **Build**: tsdown
- **Test**: vitest
- **Lint**: eslint

## Architecture Quick Reference

**Pattern**: FCIS (Functional Core, Imperative Shell) + Ports

```text
┌─────────────────────────────────────────────────────┐
│                      Shell                          │
│  (I/O, CLI commands, orchestration)                 │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │                   Core                       │   │
│  │  (Pure functions, business logic, no I/O)   │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │  Port    │  │  Port    │  │  Port    │         │
│  │ (State)  │  │(OpenCloud)│ │ (Config) │         │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘         │
└───────┼─────────────┼─────────────┼───────────────┘
        │             │             │
   ┌────▼────┐  ┌─────▼────┐  ┌────▼─────┐
   │ Adapter │  │ Adapter  │  │ Adapter  │
   │ (Gist)  │  │ (HTTP)   │  │  (c12)   │
   └─────────┘  └──────────┘  └──────────┘
```

- **Core**: Pure functions, no side effects, easy to test
- **Shell**: Orchestrates I/O, calls core with data from adapters
- **Ports**: Interfaces defining what adapters must implement
- **Adapters**: Concrete implementations (Gist, Open Cloud HTTP, etc.)

## Testing Requirements (NON-NEGOTIABLE)

**TDD is mandatory. No implementation without a failing test first.**

1. **RED** - Write a failing test describing expected behavior
2. **GREEN** - Write minimum code to pass
3. **REFACTOR** - Clean up, keep tests green

**Test levels:**

| Layer    | Test with         | Isolation     |
| -------- | ----------------- | ------------- |
| Core     | Unit tests        | None needed   |
| Shell    | Integration tests | Fake adapters |
| Adapters | Adapter tests     | nock for HTTP |
| E2E      | Scenario tests    | Real APIs     |

**Coverage**: 100% required (statements, branches, functions, lines)

**Naming**: `it("should <behavior>")` - enforced by ESLint

**Anti-patterns (will be rejected):**

- Writing implementation before tests
- Testing mock behavior instead of real behavior
- Mocking without understanding dependencies

See `docs/adr/003-testing-strategy.md` for full details.

## Key Decisions

See `docs/adr/` for full Architecture Decision Records.

- **TypeScript over Rust**: Community contribution accessibility
- **Open Cloud only**: ROBLOSECURITY is deprecated, Open Cloud is the future
- **GitHub Gists for state**: Zero external service, works with GITHUB_TOKEN
- **Multi-format config**: Support TS, JS, YAML, JSON via c12

## Common Commands

```bash
pnpm install        # Install dependencies
pnpm build          # Build for production
pnpm dev            # Watch mode
pnpm test           # Run tests
pnpm lint           # Check/fix linting
pnpm typecheck      # TypeScript validation
```

## Project Structure

```text
bedrock/
├── src/              # Source code
├── docs/
│   ├── adr/          # Architecture Decision Records
│   ├── plans/        # Feature implementation plans
│   └── templates/    # Document templates
├── .github/          # GitHub templates and workflows
└── .claude/          # Claude Code configuration
```

## Development Workflow

### Before Committing

1. Run `pnpm lint` (auto-fixes style issues)
2. Run `pnpm test` (must pass)
3. Run `pnpm typecheck` (must pass)

### Creating Issues

Use GitHub issue templates for:

- Bug reports
- Feature requests
- Documentation improvements

### Making Decisions

For significant architectural choices, create an ADR using the template in
`docs/templates/adr.md`.

## Constraints

1. **Open Cloud only**: Never use ROBLOSECURITY or legacy APIs
2. **No secrets in state**: State files contain only resource IDs (public data)
3. **Backwards compatibility**: Maintain Mantle migration path

## Documentation

| Location          | Purpose                           |
| ----------------- | --------------------------------- |
| `README.md`       | Project introduction, quick start |
| `ROADMAP.md`      | High-level vision and milestones  |
| `docs/adr/`       | Why decisions were made           |
| `docs/plans/`     | How features are implemented      |
| `docs/templates/` | Reusable document templates       |
