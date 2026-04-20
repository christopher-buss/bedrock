# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Package Overview

`bedrock` is the primary published package of the project: a programmatic
TypeScript IaC library for Roblox, with a CLI wrapper as a convenience entry
point. Every symbol exported from `src/index.ts` is public API subject to
semver (see [ADR-017](../../docs/adr/017-product-framing-programmatic-iac-with-cli.md)).

Roblox Open Cloud access comes from
[`@bedrock/ocale`](../open-cloud/CLAUDE.md), which this package consumes as
a workspace dependency. Bedrock does not talk to HTTP directly.

## Architecture

FCIS + Ports with an explicit primary/driven port distinction per
[ADR-018](../../docs/adr/018-fcis-ports-with-primary-driven-distinction.md).
Source layout under `src/`:

| Folder | Role |
| --- | --- |
| `types/` | Branded primitives (`ResourceKey`, `RobloxAssetId`, `Sha256Hex`) and shared type definitions. |
| `core/` | Pure domain: data contracts, `diff`, desired-state normalization. No I/O. |
| `ports/` | Driven port interfaces (`ResourceDriver<K>`, `StatePort`). The contracts external systems are reached through. |
| `adapters/` | Driven adapter implementations (`GamePassDriver` wrapping `@bedrock/ocale`, future state adapters). |
| `shell/` | Use-case orchestration (`applyOps`, `buildDesired`, future `deploy`). Calls core with data pulled from adapters. |

A `src/bin/` directory will land in a later slice for the CLI primary
adapter. The programmatic primary surface is `src/index.ts` itself.

## Design principles

### No OOP ceremony

Per ADR-018, the following patterns are out of scope:

- No DI containers. Dependencies are injected as function arguments or as
  constructor parameters on plain objects.
- No application-service classes. Shell functions are module-level.
- No domain models with methods. Types in `core/` and `types/` are plain data
  structs.
- No factory classes. A lowercase factory function is acceptable; a
  `GamePassFactory` class is not.

The domain is a set of pure data transformations. Adding behavior onto types
adds indirection without testability or flexibility gains.

### Public API discipline

Every symbol exported from `src/index.ts` is public API. Per
[ADR-005](../../docs/adr/005-jsdoc-example-testing.md), each public export
carries a JSDoc `@example` block that is both rendered by TypeDoc and compiled
into a test case by `pnpm gen:example-tests`. Thoughtless exports accumulate
semver debt; prefer a narrower surface.

### Result types

Driven-port methods and shell functions return
`Promise<Result<T, BedrockError>>` per
[ADR-009](../../docs/adr/009-result-types-over-exceptions.md). Pure core
functions like `diff` return plain values because they have no I/O and
cannot fail.

## `ResourceDriver<K>` naming note

`ResourceDriver<K>` is a *driven* (secondary) port. In strict hexagonal
vocabulary a "driver port" is a PRIMARY port, so the name is the opposite of
its hexagonal role. The clash is deliberate: "driver" follows the Terraform,
Pulumi, and Mantle IaC convention for a component that talks to a specific
resource API, which the target audience recognizes immediately.

Do not cite ADRs in code comments or JSDoc on `ResourceDriver<K>` (or anywhere
else in `src/`). Rendered JSDoc ships to the public docs site; ADR numbers are
internal governance. Keep the rationale here, in this CLAUDE.md, and in the
ADRs themselves.

## Testing

The RED → GREEN → REFACTOR cycle and 100% coverage requirement are defined in
the root [CLAUDE.md](../../CLAUDE.md) and
[ADR-003](../../docs/adr/003-testing-strategy.md). This package follows both.

Layout:

- Unit tests live colocated as `*.spec.ts` alongside their subject in `src/`.
- Integration tests live in `tests/integration/` and consume the fake HTTP
  client from `@bedrock/ocale/testing` (the subpath is only resolvable in
  workspace dev/test flows under `--conditions source`, never from npm
  consumers).
- Type-level tests for public API live in `*.spec-d.ts` files using
  `expectTypeOf` (per project convention).

## Related documentation

- Root [CLAUDE.md](../../CLAUDE.md)
- [`@bedrock/ocale` CLAUDE.md](../open-cloud/CLAUDE.md)
- [ADR-002](../../docs/adr/002-monorepo-fcis-architecture.md): FCIS + Ports (ADR-018 is the refinement).
- [ADR-003](../../docs/adr/003-testing-strategy.md): testing strategy, TDD, 100% coverage.
- [ADR-005](../../docs/adr/005-jsdoc-example-testing.md): public API `@example` obligation.
- [ADR-009](../../docs/adr/009-result-types-over-exceptions.md): Result types.
- [ADR-011](../../docs/adr/011-simplified-architecture-for-library-packages.md): the simplified-architecture opt-out. This package fails criteria 2, 3, 4, and 5 and uses full FCIS + Ports.
- [ADR-013](../../docs/adr/013-hk-git-hook-manager-with-differentiated-gating.md): `hk` pre-commit gating.
- [ADR-017](../../docs/adr/017-product-framing-programmatic-iac-with-cli.md): product framing.
- [ADR-018](../../docs/adr/018-fcis-ports-with-primary-driven-distinction.md): architecture refinement.
- [ADR-019](../../docs/adr/019-state-data-model-and-diff-algebra.md): state data model and diff algebra.
- PRD [#54](https://github.com/christopher-buss/bedrock/issues/54): implementing plan for slice 1.
