# ADR-018: Architecture Refinement -- FCIS + Ports with Explicit Primary/Driven Port Distinction

**Date:** 2026-04-17  **Status:** Accepted

Refines: ADR-002 (FCIS + Ports architecture)

Decision Makers: Maintainer  
Tags: architecture, fcis, ports, hexagonal, plugin-system, public-api

## Context

ADR-002 established Functional Core, Imperative Shell (FCIS) + Ports as
Bedrock's architecture. It rejected full hexagonal architecture on the grounds
that "Bedrock is a CLI tool, not a business domain application." That
justification is no longer accurate.

ADR-017 established that Bedrock is a programmatic TypeScript IaC library whose
CLI is one of several entry points -- not the sole entry point. There are now
multiple ways to invoke Bedrock (CLI, programmatic API, future plugins) and
multiple things Bedrock reaches out to (Open Cloud via `@bedrock-rbx/open-cloud`,
future state backends, future config sources). This is precisely the topology
that ports and adapters were designed for. The port structure is genuinely
needed -- not just for testability, but because the boundaries are real and will
be crossed by third parties.

What remains unchanged: the rejection of full hexagonal's OOP ceremony. ADR-002
rejected that ceremony for the wrong stated reason ("we're just a CLI"). The
correct reason is that Bedrock's domain is naturally functional: its core logic
is pure data transformations, not stateful business objects. Application-service
classes, domain models with behavior, and DI containers add ceremony without
payoff in a codebase where the core is already pure and testable without mocks.

ADR-018 refines ADR-002 by:

1. Replacing the outdated justification with the accurate one.
2. Making the primary/driven port distinction explicit in vocabulary, folder
   layout, and documentation.
3. Formally acknowledging the `ResourceDriver<K>` terminology choice and its
   deliberate departure from strict hexagonal naming.

ADR-002's structural decision -- FCIS + Ports, not full hexagonal -- stands.

## Vocabulary

These terms are used throughout this ADR and in contributor-facing materials
(code comments, CLAUDE.md). They are **not** exposed in user-facing docs (the
TypeDoc API reference, plugin author tutorials): those use plain language.

| Term | Meaning |
| ---- | ------- |
| **Primary port** | An interface the core exposes for external actors to invoke. Primary adapters (CLI, programmatic API, future plugins) call through this interface to drive Bedrock's behavior. The core defines the port; the adapter calls it. Current examples: the CLI entrypoint (`packages/cli/src/bin/`), the programmatic public API (`src/index.ts`). Primary ports correspond to "driver ports" in strict hexagonal terminology. |
| **Driven port** | An interface through which Bedrock reaches out to an external system. Driven adapters implement these. Current example: `ResourceDriver<K>` (Open Cloud resources via `@bedrock-rbx/open-cloud`). Future examples: `StatePort` (Gist / S3 / R2), `ConfigPort` (c12). Driven ports correspond to "secondary ports" in strict hexagonal terminology. |
| **`ResourceDriver<K>`** | Bedrock's generic driven-port interface, indexed by resource kind `K`. Despite containing the word "driver," this is a **driven** (secondary) port -- the opposite of a hexagonal "driver port," which means primary. The name follows the Terraform / Mantle IaC community convention where "driver" means "the component that talks to a specific resource API." This deliberate mismatch with hexagonal vocabulary is explained in Implementation Notes. |

## Decision

Bedrock uses **FCIS + Ports with an explicit primary/driven distinction**.

The structural choice from ADR-002 is preserved: FCIS + Ports, not full
hexagonal. The rationale is updated:

- **Full hexagonal is rejected because of OOP ceremony, not because we are a
  CLI.** Full hexagonal prescribes application-service classes, domain models
  with behavior, and DI container wiring. Bedrock's domain is a set of pure data
  transformations (diff, desired-state construction, operation planning). There
  are no stateful domain objects, no aggregates, no repositories in the DDD
  sense. Imposing OOP ceremony on a naturally functional domain adds indirection
  without improving testability or flexibility.

- **FCIS + Ports is chosen because the boundaries are real.** Multiple external
  actors invoke Bedrock (CLI, programmatic API, plugins). Multiple external
  systems are reached from Bedrock (resource APIs, state storage, config
  sources). The port-and-adapter structure gives these boundaries names, makes
  them testable, and lets third parties implement driven ports (e.g. custom
  `ResourceDriver<K>` implementations) without depending on Bedrock internals.

Concretely, the folder layout under `packages/cli/src/` is:

```text
packages/cli/src/
├── index.ts          # Primary API surface (programmatic entry point)
├── types/            # Branded primitives and shared type definitions
├── core/             # Pure domain: types, diff, desired-state types and normalization
├── shell/            # Use-case orchestration: applyOps, buildDesired, deploy
├── ports/            # Driven port interfaces: resource-driver.ts, future
│                     #   state-port.ts, config-port.ts
└── adapters/         # Driven adapter implementations: game-pass-driver.ts,
                      #   future gist-state-adapter.ts, c12-config-adapter.ts

packages/cli/src/bin/ # CLI primary adapter (slice 2; invokes shell functions)
```

The `shell/` name is kept from ADR-002 for continuity. "Shell" already connotes
"I/O orchestration" in the FCIS vocabulary; renaming to `use-cases/` or
`services/` would add hexagonal vocabulary without adding clarity.

Primary adapters other than the CLI (programmatic `index.ts`, future plugin
entrypoints) are not co-located in a `primary-adapters/` folder -- the
programmatic API is the barrel export itself, and plugins are third-party. There
is no folder to create.

## Consequences

### Positive

- Contributor mental model is accurate. "We use ports and adapters because we
  have real, multiple-implementation boundaries" is a better explanation than
  "we use it for testability but we're just a CLI."
- Third-party plugin authors have a named contract (`ResourceDriver<K>`) with
  stable semantics. The driven-port vocabulary in code comments and CLAUDE.md
  gives contributors a precise frame for where new adapters belong.
- The architecture is forward-compatible with the plugin system (ADR-017,
  v0.3+) and with new state backends (S3, R2) without any structural change.
- Full hexagonal's ceremony is explicitly off the table. Contributors arriving
  from enterprise TypeScript backgrounds cannot introduce application-service
  classes or DI containers and cite "architecture" as justification.

### Negative

- Two vocabulary layers exist: internal primary/driven terminology vs. plain
  user-facing language. Contributors must learn when to use which register.
  Mitigated by the glossary table in this ADR and a note in CLAUDE.md.
- `ResourceDriver<K>` is a permanent terminology inconsistency: "driver" in our
  codebase means the opposite of "driver port" in strict hexagonal. Readers who
  know hexagonal deeply will notice. Mitigated by the glossary and Implementation
  Notes, but the inconsistency cannot be fully eliminated without renaming.

### Neutral

- ADR-002's FCIS folder vocabulary (`core/`, `shell/`, `ports/`, `adapters/`)
  is preserved. No migration of existing code is required.
- ADR-011's simplified-architecture opt-out does not apply to the CLI package.
  That verdict is unchanged (see Related Decisions).

### Revisit criteria

This ADR should be reopened if any of the following occur:

- **A genuine OOP-ceremony need emerges.** If a future feature genuinely
  requires an application-services layer, domain models with behavior, or a DI
  container -- and the functional alternative is materially worse, not just
  unfamiliar -- the anti-pattern list should be revisited before the feature is
  implemented.
- **The primary/driven vocabulary proves unusable in practice.** If contributors
  consistently confuse primary vs. driven ports despite the glossary and
  CLAUDE.md note, simpler terminology (e.g. "entry ports" and "exit ports")
  should be considered.
- **The `ResourceDriver<K>` terminology clash becomes actively misleading.**
  Today the mismatch is mildly paradoxical; a reader who knows hexagonal will
  notice but quickly understand. If a shift in industry vocabulary makes the
  clash genuinely confusing to the majority of contributors, the rename cost
  should be re-evaluated.

## Alternatives Considered

### Full hexagonal architecture

Application-services layer as classes, domain models with behavior (aggregates,
value objects), DI container for dependency injection.

**Rejected** because Bedrock's domain is a set of pure data transformations.
There are no stateful domain objects that benefit from encapsulation, no
aggregates with lifecycle, no repositories managing identity. FCIS achieves the
same testability and flexibility (pure core, swappable adapters) without the
class hierarchy. The cost -- learning hexagonal's OOP vocabulary -- is not
justified when the domain does not call for it.

### Rename `ResourceDriver<K>` to `ResourcePort<K>` for hexagonal consistency

Align our driven-port naming with strict hexagonal vocabulary. "Port" for the
interface, "adapter" for the implementation.

**Rejected.** "Driver" is the established convention in the Terraform, Pulumi,
and Mantle ecosystems for the component that talks to a specific resource API.
roblox-ts developers and IaC practitioners already understand this concept under
that name. Renaming to `ResourcePort<K>` gains hexagonal consistency at the cost
of IaC-community familiarity. The mismatch is acknowledged in the glossary and
Implementation Notes; it does not impair contributors once they read the
definition.

### Introduce a `primary-adapters/` folder alongside `ports/` and `adapters/`

Make the primary/driven distinction visible in the folder structure by housing
primary adapters (CLI, programmatic API) in an explicit directory.

**Rejected.** The programmatic API is the `index.ts` barrel export -- there is
no adapter file to place. The CLI adapter lives in `bin/` because it is an
executable entry point, not because it is an "adapter" in the same sense as a
driven adapter. A `primary-adapters/` folder would either be empty or contain
only a single file (`bin/`), making it ceremony rather than structure. The
primary/driven distinction is documented in vocabulary, not enforced by folder
layout for primary adapters.

## Implementation Notes

### Functional domain -- the positive statement and anti-pattern list

The domain is naturally functional: pure data structs, pure functions, no
behavior on types. A `GamePassDesiredState` is a plain data object; `diff` is a
function from two data objects to a list of operations; `applyOps` is a function
from operations and a driver registry to a result.

The following patterns are explicitly out of scope for the CLI package:

- **No DI containers.** Dependencies are injected as function arguments or
  constructor parameters on plain objects. No IoC container, no `@Injectable`,
  no service locator.
- **No application-service classes.** Shell functions (`applyOps`, `deploy`,
  `buildDesired`) are module-level functions, not methods on a class instance.
- **No domain models with methods.** Types in `core/` and `types/` are plain
  data structs (TypeScript interfaces and type aliases). Behavior lives in
  functions, not on types.
- **No factory classes.** Object construction is done with plain object literals
  or constructor functions. A factory function (lowercase, no `new`) is
  acceptable; a `GamePassFactory` class is not.

### `ResourceDriver<K>` and the hexagonal terminology clash

In strict hexagonal architecture, a "driver port" is a PRIMARY port -- the
interface through which an external actor drives the application. Our
`ResourceDriver<K>` is the opposite: it is a DRIVEN (secondary) port through
which Bedrock reaches out to an external resource API.

The name was chosen deliberately, for two reasons:

1. **IaC community convention.** In Terraform's provider model, Pulumi's
   resource providers, and Mantle's predecessor architecture, the component that
   talks to a specific cloud resource API is called a "driver." Roblox-ts
   developers and IaC practitioners arriving at Bedrock's plugin API will
   recognise this pattern immediately under the familiar name.

2. **No functional gain from renaming.** `ResourcePort<K>` would be hexagonally
   correct but would cost contributor goodwill on a concept the IaC community
   already understands. The glossary table in this ADR names the inconsistency
   explicitly; any contributor who is confused has a single place to look.

The inconsistency is accepted as a deliberate pragmatic choice. It does not
affect how the interface is implemented or tested; it affects only the label.
Code comments on `ResourceDriver<K>` should note: "driven (secondary) port in
hexagonal terms; named 'driver' per IaC community convention -- see ADR-018."

### `DriverRegistry` pattern

The `DriverRegistry` is a plain object (or `Map`) indexed by resource kind `K`,
mapping each kind to its `ResourceDriver<K>` implementation. `applyOps` receives
a registry and dispatches each operation to the appropriate driver:

```ts
// ports/resource-driver.ts
export interface ResourceDriver<K extends ResourceKind> {
	create(
		desired: ResourceDesiredState<K>,
	): Promise<Result<ResourceCurrentState<K>, OpenCloudError>>;
	// update and delete are deferred. update ships when @bedrock-rbx/ocale's
	// resource clients gain update capability; delete ships when a
	// delete-capable resource lands. Slice 1 has create only; applyOps
	// returns err(unsupported) if it encounters an Update op.
}

// shell/apply-ops.ts (simplified)
export async function applyOps(
	ops: ReadonlyArray<Operation>,
	registry: DriverRegistry,
): Promise<Result<void, OpenCloudError>> {
	/* ... */
}
```

This pattern is type-safe (TypeScript infers `K` from the registry key), easily
extensible (add a new key), and third-party-friendly (implement the interface,
pass it in). It does not require a DI container.

## Related Decisions

- **ADR-002**: Monorepo with FCIS + Ports Architecture -- this ADR refines
  ADR-002. The structural decision (FCIS + Ports, not full hexagonal) is
  preserved. The rationale is updated: we reject hexagonal ceremony because our
  domain is naturally functional, not because we are "just a CLI." A header line
  is added to ADR-002 noting this refinement.
- **ADR-011**: Simplified Architecture for Library Packages -- ADR-018
  strengthens but does not change ADR-011's verdict for the CLI package. The CLI
  fails ADR-011's criteria 2, 3, 4, and 5 because it has a pure core separable
  from I/O (criterion 4), multiple real swappable driven adapters (criteria 3
  and 5), and substantive deployment logic beyond pass-through (criterion 2).
  ADR-011 itself is untouched.
- **ADR-017**: Product Framing -- the product decision that made ADR-002's "CLI
  tool" justification incomplete. ADR-018 exists because ADR-017 established
  multiple primary ports; without that, the primary/driven distinction would have
  been a formalism with only one primary adapter.
- **ADR-009**: Result Types Over Exceptions -- driven port interfaces return
  `Promise<Result<T, BedrockError>>` per ADR-009. This applies to
  `ResourceDriver<K>` and all future driven ports.
- **ADR-003**: Testing Strategy -- the refined architecture preserves ADR-003's
  zero-mock testing story. The pure core is tested without mocks; driven adapters
  are tested against fakes injected at the port boundary; shell functions are
  integration-tested with fake adapters.

## Amendments

- **2026-04-25:** The CLI primary-adapter folder is `packages/bedrock/src/cli/`.
  The original Decision text places it at `packages/cli/src/bin/`; both segments
  changed after this ADR was accepted. The package was renamed to
  `@bedrock-rbx/core` (PR #163), making `packages/bedrock/` its working-tree path.
  The `bin/` segment was renamed to `cli/` when the scaffolding landed (#184)
  to align with the Node convention that `bin` names the published executable
  entry (`dist/cli/run.mjs`, declared in `package.json` `bin`) rather than the
  source folder. Source under `cli/` covers the program factory (`index.ts`),
  the executable shim (`run.ts`), output port (`render.ts`), options parser
  (`parse-options.ts`), and exit-code constants. Future command modules live
  under `cli/commands/`.
