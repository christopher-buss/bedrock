# State Relocation Between Backends Implementation Plan

**Goal:** Ship `bedrock state move`, relocating an existing bedrock state from
the **Backend** a project's config names onto another registered **Backend**.
The motivating case is a project outgrowing a gist and moving to S3; the command
is backend-agnostic, so gist to S3, S3 to gist, and any future backend inherit
it without new command code.

**Tracking:** [#594](https://github.com/christopher-buss/bedrock/issues/594).

**Delivery:** one PR titled `feat(core): add state move command`. Commit
granularity emerges from RED+GREEN per behaviour slice.

---

## Context

`bedrock migrate` converts another tool's state format into bedrock's, and its
destination picker already asks a **Backend** for the fields it declares
(`resolve-state-target.ts`). Relocation converts nothing: the `BedrockState`
read out of the old **Backend** is the value written into the new one. Routing
it through `migrate` would drag a migration report and a config-format prompt
through a path with no foreign format to report on, so it joins `state push` and
`state unlock` under the `state` namespace instead.

Everything the command needs already exists as a seam. `resolveStateConfig`
picks the `state` block per environment, `buildStatePort` turns a block into a
`StatePort`, and the registry lists every **Backend** a plugin claimed along
with the prompt fields it declares. The new work is the decision logic about
what may move, and the command that drives it.

## Decisions

| #   | Decision                                                                                                                                           | Rationale                                                                                                                                                                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | New `bedrock state move` command, not a `migrate --from <backend>` source.                                                                         | `migrate` means format conversion. A relocation has no foreign format, no migration report, and no config to emit from scratch.                                                                                                                                                                                                |
| 2   | The source is the `state` block the config already resolves per environment. It is never prompted for.                                             | The config is the project's own record of where its state lives. Prompting would let a user copy out of a store their project does not use, and silently produce a state nothing reads.                                                                                                                                        |
| 3   | The destination is named entirely in flags: `--to <backend>`, plus one `--to-<key>` per coordinate, keyed as that **Backend** declares its fields. | The command has to run with no terminal, which is what lets an agent perform a move. The keys come from the same declaration `migrate` prompts from, so a **Backend** that ships tomorrow is addressable with no change here. The assembled block is checked against that **Backend**'s own schema before either side is read. |
| 4   | Survey every environment before writing any of them. A single unmovable environment aborts before the first write.                                 | A project stranded half-moved is worse than one that never started. Both reads are cheap and both failure modes (unreadable source, occupied destination) are knowable up front.                                                                                                                                               |
| 5   | Destination writes are fenced on the version the destination's own `read` returned, so an occupied destination fails the write.                    | `StatePort.write(state, expected)` already fences. Passing the `{ kind: "absent" }` version a clean read carries makes the write a create, which is what closes the race between the survey and the write.                                                                                                                     |
| 6   | `--force` writes unfenced, overwriting whatever the destination holds.                                                                             | A re-run after a partial move needs a way through. It is opt-in because the unfenced write is the one that can destroy a state the operator did not know was there.                                                                                                                                                            |
| 7   | The source's state lock is held for the duration of the move, and released whether or not the move succeeded.                                      | A deploy landing on the source mid-move would leave the copy stale with nothing to say so. The lock is the mechanism `deploy` already uses to make that impossible.                                                                                                                                                            |
| 8   | The source copy is left in place.                                                                                                                  | Deleting the operator's other copy of their own state is not a call a move makes for them. A delete flag is a separate decision with a separate blast radius.                                                                                                                                                                  |
| 9   | The config file is not rewritten. The command prints the `state` block to apply and says the move is not complete until it is.                     | Configs are TS, JS, YAML, JSON, or Luau, and carry comments, imports, and computed values. Serializing a loaded config back over the authored file would flatten all of it. Opt-in rewriting for the mechanical formats is a follow-up.                                                                                        |
| 10  | `--dry-run` surveys, decides, and writes nothing. It takes no hold either.                                                                         | An agent checks before it commits. Nothing a survey does needs the **Environment** to itself, and holding one would block a deploy over a question.                                                                                                                                                                            |
| 10  | An environment the source holds no state for is reported and skipped.                                                                              | A first-deploy environment has no state. Writing empty state to the destination would turn "never deployed" into "deployed nothing", and the next deploy would re-create every resource.                                                                                                                                       |

## Shapes

The decision logic is pure and lives in `core/`. The command supplies records it
has already read; nothing in here does I/O.

```ts
/** Why an environment cannot move. */
type StateMoveBlocker =
	| { readonly err: StateError; readonly kind: "sourceUnreadable" }
	| { readonly kind: "destinationOccupied" };

/** What the survey decided about one environment. */
type StateMoveDecision =
	| {
			readonly expected?: StateVersion;
			readonly kind: "move";
			readonly state: BedrockState;
	  }
	| { readonly kind: "blocked"; readonly reason: StateMoveBlocker }
	| { readonly kind: "skip"; readonly reason: "sourceEmpty" };

/** One environment's survey input, both reads already performed. */
interface StateMoveSurvey {
	readonly destination: Result<StateRecord, StateError>;
	readonly environment: string;
	readonly source: Result<StateRecord, StateError>;
}

// Decides what happens to every surveyed environment. `force` collapses
// `destinationOccupied` into a `move` carrying no `expected` version.
function planStateMove(
	surveys: ReadonlyArray<StateMoveSurvey>,
	options: { readonly force: boolean },
): ReadonlyMap<string, StateMoveDecision>;
```

The shell orchestrates the reads, feeds them to `planStateMove`, and performs
the writes only when no decision is `blocked`.

```ts
interface MoveStateDeps {
	readonly acquireLock: StateLockPort["acquire"];
	readonly buildStatePort: typeof buildStatePort;
	readonly getEnv: (name: string) => string | undefined;
	readonly plugins: PluginRegistry;
}

interface MoveStateInputs {
	readonly config: Config;
	readonly destination: StateConfig;
	readonly environments: ReadonlyArray<string>;
	readonly force: boolean;
}

function moveStateAsync(
	deps: MoveStateDeps,
	inputs: MoveStateInputs,
): Promise<Result<StateMoveOutcome, StateMoveError>>;
```

## Slices

Each slice is RED+GREEN in one commit, with a refactor commit only where one
earns its place.

1. **`planStateMove` decides every environment.** The whole decision table:
   fenced move, unfenced move onto a versionless **Backend**, empty source
   skips, an occupied destination blocks, either side unreadable blocks, and
   `force` turns an occupied destination into an unfenced move.
2. **`parseStateMoveOptions` reads the destination off the flags.** `--to`,
   `--to-<key>`, `--force`, `--dry-run`, with the rest delegated to the common
   parser.
3. **`moveStateAsync` moves every environment through real ports.** Integration
   test against fake `StatePort` pairs: survey all, write all, report what
   landed. A blocked environment aborts before any write.
4. **The source's hold spans the move.** Taken before its read and given back
   after its write, holds already taken given back when a later one is refused,
   and a **Backend** offering no exclusion moved without one.
5. **`parseStateConfig` checks a block assembled outside a config file**, so a
   mistyped coordinate fails on the flag rather than against the store.
6. **`bedrock state move` is registered and drives the shell.** CLI integration
   tests over every failure surface, exit code `EXIT_OK` only when every
   environment landed.
7. **`--dry-run` surveys without writing**, and every run ends by spelling out
   the `state` block the config has to carry.
8. **`moveStateAsync` is exported from the barrel**, which is what lets a
   **Backend** shipped as a plugin drive a move against its own adapters.
9. **Gist and S3 both directions, end to end.** `packages/state-s3` integration
   test moving onto and off the bucket against the injected fake transport, on
   the same terms as its existing migrate-through-the-plugin test.

## Verification

- 100% coverage on touched source in `packages/bedrock` and `packages/state-s3`.
- `pnpm mutate:changed` clean after each commit.
- A change intent recorded with `pnpm change` against `@bedrock-rbx/core`, and
  against `@bedrock-rbx/state-s3` if slice 7 touches its source.
- `@since unreleased` on anything new reaching a package barrel.

## Out of scope

- Deleting the source copy after a successful move.
- Rewriting the config file in place. Worth a follow-up for the YAML and JSON
  formats, where the file is mechanically round-trippable.
- Moving a subset of a single environment's resources.
- A source located by prompted coordinates rather than by the project's config,
  which is what a recovery tool would need and a relocation does not.
- An interactive picker filling in a destination the flags left unnamed. The
  refusal names every **Backend** available and the coordinates each one needs,
  which is what both a person and an agent act on.
