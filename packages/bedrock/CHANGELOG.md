# @bedrock-rbx/core

## 0.1.3

### Patch Changes

- Updated dependencies [[`10282c6`](https://github.com/christopher-buss/bedrock/commit/10282c6400796788f50edbc88e8ae868d8b5671e)]:
  - @bedrock-rbx/ocale@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies [[`8338686`](https://github.com/christopher-buss/bedrock/commit/833868626954ec6613d2268cbe8b7a8ccc52310b)]:
  - @bedrock-rbx/ocale@0.1.2

## 0.1.1

### Patch Changes

- [#525](https://github.com/christopher-buss/bedrock/pull/525) [`e896fed`](https://github.com/christopher-buss/bedrock/commit/e896fed5540d8f70e3077146db3b93840d9e605f) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Enrich API errors with request context and summarize gateway error pages.
  `ApiError` now carries the request `method`, `url`, `elapsedMs`, and an
  allowlisted set of `responseHeaders` (server/edge/request-id headers useful for
  escalation), and an HTML load-balancer error page is captured as a short
  `gatewaySummary` rather than retained whole. Deploy failure messages render this
  context on one line — `on METHOD url after Ns`, a gateway summary in place of a
  raw HTML dump, and any captured headers — and no longer re-dump a response body
  whose message already appears in the status line.

- [#524](https://github.com/christopher-buss/bedrock/pull/524) [`8a28977`](https://github.com/christopher-buss/bedrock/commit/8a28977a6f4bd795f0ca8cfe599f7b12ef882590) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Preserve more diagnostic detail on failures. `RateLimitError` now carries the
  429 response body on `details` (parsed JSON or truncated raw text) plus the
  `statusCode`, mirroring `ApiError`. Deploy, codegen, and config-load failure
  messages now render the underlying `cause` chain instead of only the outermost
  error message, so a wrapped build, emit, write, file-read, or config-function
  throw stays diagnosable from the log alone.
- Updated dependencies [[`e896fed`](https://github.com/christopher-buss/bedrock/commit/e896fed5540d8f70e3077146db3b93840d9e605f), [`8a28977`](https://github.com/christopher-buss/bedrock/commit/8a28977a6f4bd795f0ca8cfe599f7b12ef882590)]:
  - @bedrock-rbx/ocale@0.1.1

## 0.1.0

### Minor Changes

- [#512](https://github.com/christopher-buss/bedrock/pull/512) [`9ff30ba`](https://github.com/christopher-buss/bedrock/commit/9ff30baf6537b5a7f2706e6a8f192f5cccbf9dd4) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Add a `bedrock build` CLI subcommand that produces place artifacts by discovering and spawning a `.bedrock/build.ts` override, using the same discovery and spawn contract as `.bedrock/deploy.ts` (credentials forwarded as env-var overrides, `--config`/`--env` in argv) and propagating the override's exit code. The build is entirely the override's job with no built-in default, so a project whose config enables `codegen` but ships no `.bedrock/build.ts` fails with an actionable message, while a project without codegen has nothing to produce and exits successfully. The command is independent of `deploy`: it loads config only when no override is present and can be run standalone.

- [#484](https://github.com/christopher-buss/bedrock/pull/484) [`362f884`](https://github.com/christopher-buss/bedrock/commit/362f8849db45d1615b8c91bc873b3313623c805e) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Add an opt-in codegen engine. When `codegen.enabled` is set in config, bedrock assembles the current state of every declared environment after a successful state write and writes the emitter's returned files through an injected writer (node-fs by default). A partial apply still emits the keys that resolved while the deploy returns `applyFailed`. Surfaces the `Emitter`/`EmitInput`/`CodegenFile` contract, the `CodegenWriterPort` with `createFsCodegenWriter`, and the `CodegenConfig`, `CodegenError`, and `CodegenWriteError` types from the public API. The emitter and output directory used when none are configured are covered by the default-emitter change in this release.

- [#493](https://github.com/christopher-buss/bedrock/pull/493) [`3e86df5`](https://github.com/christopher-buss/bedrock/commit/3e86df5191de8a1fc0ae0925a0374ae0a3725e5e) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Add a zero-config default codegen emitter. When `codegen.enabled` is set and no `emit` override is supplied to `deploy()`, bedrock now writes `resources.luau` — a Luau module of deployed Roblox IDs keyed by environment, then resource key, then that resource's outputs (asset IDs, icon asset IDs, and the like, including the real IDs of redacted resources). Asset IDs are emitted as Luau number literals. Setting `codegen.typeDeclarations: true` also writes a `resources.d.ts` companion so roblox-ts consumers get type-safety over the same module. The output directory defaults to `.bedrock/generated` (consumed as `@bedrock/generated/resources`) when `codegen.output` is unset. The default emitter is exported as `createDefaultEmitter` so a custom `emit` can wrap rather than replace it.

- [#503](https://github.com/christopher-buss/bedrock/pull/503) [`2b2c19f`](https://github.com/christopher-buss/bedrock/commit/2b2c19fe2c2f6e445782b4be33dc237eeb6fc1db) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Add two helpers for writing custom codegen emitters. `findResource(resources, { kind, key })` looks up a single resource in `state.resources`, narrowed to its kind so `outputs` and kind-specific fields are typed without a hand-written predicate; omit `key` to take the first resource of the kind. `codegenViewOf(state, resource)` projects a resource into its redaction-aware codegen view, resolving the resource's `realDisplay` sibling from state for you, so an emitter no longer re-derives the internal `kind:key` composite to call `codegenView`.

- [#502](https://github.com/christopher-buss/bedrock/pull/502) [`9972d63`](https://github.com/christopher-buss/bedrock/commit/9972d638f16fd85008fe8b75887e00b3a4b41539) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Trigger a two-phase rebuild from the codegen-content fingerprint instead of a provisioned `create`. A deploy now rebuilds and republishes a place whenever the generated source _would_ change (including a price/name `update` that embeds a mutable value into the place), not only when a `create` mints a new ID. After codegen runs, `deploy()` hashes the emitted output and rebuilds iff that hash differs from the one stored in state (or a pending-rebuild marker is set), otherwise it publishes the pre-built file; the stored hash advances only on a successful republish, so an aborted rebuild self-heals on the next deploy. The fingerprint is persisted as a diff-ignored `codegenHash` in the adapter-private `$bedrock` envelope and is v1-compatible. Two-phase now requires active codegen: with a rebuild hook but no codegen there is no generated source to fingerprint, so the place publishes in a single pass. Because the rebuild re-runs the build after codegen rewrites source, a two-phase deploy environment needs the build toolchain, not just a pre-built artifact.

- [#498](https://github.com/christopher-buss/bedrock/pull/498) [`9793fcd`](https://github.com/christopher-buss/bedrock/commit/9793fcd96fb4ccb0830a09265bbf1604d696c07d) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Expose real (pre-redaction) display values to codegen emitters. A redacted resource (ADR-024) previously persisted only the pushed placeholder values, so an `emit` function could not recover the real name, price, or description to write into generated game source. Bedrock now persists the real values in a diff-ignored `$realDisplay` sibling on each resource in the state file — `serializeStateFile`/`parseStateFile` own that mapping, while `diff` and the state merge stay redaction-blind. Emitters read a co-located per-field view: `codegenView(resource, realDisplay)` widens each redactable field to `Field<T> = T | { value, redacted }`, and the exported `realValue` / `pushedValue` / `isRedacted` helpers narrow it without hand-rolling the union. Non-redacted fields stay plain scalars. Surfaces `codegenView`, `realValue`, `pushedValue`, `isRedacted`, and the `Field`, `CodegenView`, and `ResourceRealDisplay` types from the public API.

- [#515](https://github.com/christopher-buss/bedrock/pull/515) [`7c8ce8c`](https://github.com/christopher-buss/bedrock/commit/7c8ce8c6b6fc7df5f8ebee3f44b2e021937d498b) Thanks [@christopher-buss](https://github.com/christopher-buss)! - **Breaking:** `deploy` is now the fused composition of `provision → build → publish`, and the in-process rebuild hook is removed.

  - `DeployOptions.rebuild` and `DeployOptions.clearPendingRebuild` are **removed** (deleted, not deprecated), along with the `RebuildHook` and `RebuiltPlace` types and the `rebuildHookThrew` / `pendingRebuildWithoutHook` error variants. `.bedrock/build.ts` is the single build mechanism.
  - For a codegen project, `deploy` always builds after codegen: it runs the provision stage (mint assets, checkpoint with every declared place marked `pendingRebuild`, run the emitter), invokes the new build step once, and publishes the on-disk artifacts. The `codegenHash`-gated "rebuild vs. reuse-pre-built" branch is retired; `codegenHash` is bookkeeping only. No-codegen projects still publish pre-built place files in a single pass.
  - New `DeployOptions.build` (`BuildStep`) supplies the build programmatically; the CLI injects one that spawns the discovered `.bedrock/build.ts` override on the same credential/argv contract as `bedrock build`. Codegen enabled with places declared but no build step available is a `missingBuildStep` error; a throwing build step surfaces `buildFailed` with the checkpoint marker persisted, self-healing on the next green run.
  - No-op deploys upload nothing via the place file-hash comparison, and a green deploy settles the `pendingRebuild` marker (republished and already-current places clear it; only failed places keep it).
  - `bedrock diff` now reports persistent `pendingRebuild` markers as drift ("N place(s) minted but unpublished"), and `DiffPreview` gains a required `pendingRebuild` key list.

- [#514](https://github.com/christopher-buss/bedrock/pull/514) [`a3ad783`](https://github.com/christopher-buss/bedrock/commit/a3ad7834e95da822f48df81d177a895382a5ad2e) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Add `provision` and `publish` commands that split the two-phase deploy at its checkpoint seam. `provision` runs the asset stage plus codegen (minting IDs, persisting mutable asset fields, running the emitter, and setting the `pendingRebuild` marker) without building or publishing any place. `publish` is a pure uploader that publishes the on-disk artifact for each `pendingRebuild` place (deduped by file hash), clearing the marker per republished place, with no mint, codegen, or build. Both are exposed programmatically (`provision(options)`, `publish(options)`) and as CLI subcommands (`bedrock provision`, `bedrock publish`), each overridable via `.bedrock/provision.ts` / `.bedrock/publish.ts`. `deploy` behaviour is unchanged.

  `provision` reads only asset inputs and `publish` reads only place inputs, so `provision` can run before the place artifact is built and neither stage fails on a file-backed input it does not own (a place `.rbxl` for `provision`, an asset icon for `publish`).

  `buildDesired` now takes a single options object (`buildDesired({ resources, readFile, includeKind? })`) instead of positional `(resources, readFile)` arguments, gaining an optional `includeKind` predicate that limits which kinds are read and normalized.

- [#517](https://github.com/christopher-buss/bedrock/pull/517) [`29bcf4e`](https://github.com/christopher-buss/bedrock/commit/29bcf4ef7915d6561a8c9736f3f08e79c7351c24) Thanks [@christopher-buss](https://github.com/christopher-buss)! - CLI overrides now run on the runtime that invoked the CLI instead of requiring Bun.

  `bedrock <command>` dispatches a `.bedrock/<command>.ts` override by spawning
  `process.execPath` (the same binary already executing the CLI) rather than a
  hardcoded `bun` looked up on `PATH`. Running the CLI through node no longer
  requires a Bun install, and running it through Bun keeps Bun.

  **Breaking** for projects whose overrides relied on the implicit Bun runtime:
  under node the override must use erasable-syntax TypeScript (no enums or
  namespaces) and relative imports must spell out their `.ts` extension. The
  package's supported node range (>= 24.12) executes TypeScript natively. Invoke
  the CLI through Bun (`bunx bedrock ...`) to keep the previous behavior.

- [#487](https://github.com/christopher-buss/bedrock/pull/487) [`8589d93`](https://github.com/christopher-buss/bedrock/commit/8589d937082145332f74af0661d5e271d9e769b3) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Add the happy-path two-phase deploy. Supply a `rebuild` hook to `deploy()` and, when the diff contains a provisioned `create` (a game pass or developer product), bedrock mints the assets first, persists them with a pending-rebuild marker, runs codegen, invokes the hook with the post-asset-stage state, then republishes each returned place from the hook's rebuilt bytes, embedding freshly minted IDs in a single deploy instead of a second one. Multi-place universes republish per keyed entry, and the marker is cleared once the places are republished. With no hook supplied, places publish in a single pass exactly as before. Surfaces the `RebuildHook`, `RebuiltPlace`, and `ResourceApplyContext` types from the public API; `ResourceDriver.create`/`update` now accept an optional apply-context argument.

- [#489](https://github.com/christopher-buss/bedrock/pull/489) [`d5a7c37`](https://github.com/christopher-buss/bedrock/commit/d5a7c378d5198112c2965b5c42a3c5dd1f06404c) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Make two-phase deploy self-healing and convergent. A rebuild hook that throws now leaves the minted asset outputs and the pending-rebuild marker persisted and returns a `rebuildHookThrew` error instead of crashing `deploy()`. The next deploy re-activates two-phase from that marker (the assets are already created, so they `noop`) and republishes the marked place, forcing the publish even when the place's own diff is a `noop`. A marker present with no rebuild hook available is now a hard error (`pendingRebuildWithoutHook`) rather than a green-but-stale success; pass the new `clearPendingRebuild` option to `deploy()` to clear a stuck marker and deploy normally when deliberately abandoning two-phase. On a partial asset failure the deploy now also emits codegen for the resolved keys only.

### Patch Changes

- [#491](https://github.com/christopher-buss/bedrock/pull/491) [`b68a2df`](https://github.com/christopher-buss/bedrock/commit/b68a2df1437f75878cdcccf66dd8193e57bf5a67) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Cut the gist state adapter's GitHub API usage on writes. After a state write, the read-your-write visibility poll now issues conditional GETs (`If-None-Match`) once a stale replica reveals its ETag: a replica still serving the prior body answers `304 Not Modified`, which GitHub does not count against the primary REST rate limit. A slow-to-propagate write now costs roughly one charged GET instead of one per poll attempt, lowering the chance of a `403` rate-limit exhaustion under frequent deploys.

- [#523](https://github.com/christopher-buss/bedrock/pull/523) [`cab8151`](https://github.com/christopher-buss/bedrock/commit/cab81510cd38b108e74f844e802d209fd1c4766b) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Gist state read/write failures now carry GitHub's error response body
  (bounded to 500 characters) in the failure reason instead of only the status
  code, and state-path network errors name the transport code (for example
  `ECONNRESET`) from the fetch error's cause chain.

- [#482](https://github.com/christopher-buss/bedrock/pull/482) [`b36a6eb`](https://github.com/christopher-buss/bedrock/commit/b36a6ebf5ea51f278afe147895041b98001342ad) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Initial 0.1.0 stable release. Graduates the package from the `0.1.0-beta` line to a stable, semver-tracked release with a published changelog and provenance.

- [#492](https://github.com/christopher-buss/bedrock/pull/492) [`05a1b49`](https://github.com/christopher-buss/bedrock/commit/05a1b49f1f3eee5a196bec185ebe6ac76294daa0) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Correct package documentation and publish metadata for the first release: fix the README quick-start examples to match the real config and client APIs, ship a LICENSE file inside each package, and repair the ocale package repository link.

- [#495](https://github.com/christopher-buss/bedrock/pull/495) [`fe924a2`](https://github.com/christopher-buss/bedrock/commit/fe924a29a396cd67c9b3dfa3c33bf52841696540) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Document the introducing version of every public symbol with a JSDoc `@since 0.1.0` tag, now surfaced in the API docs and IDE hovers.

- [#523](https://github.com/christopher-buss/bedrock/pull/523) [`cab8151`](https://github.com/christopher-buss/bedrock/commit/cab81510cd38b108e74f844e802d209fd1c4766b) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Surface the API response body on deploy failure lines. A driver failure whose
  error carried a response body (for example a bare `HTTP 400` from a place
  publish) now appends that body (bounded to 500 characters) to both the live
  per-resource progress line and the terminal failure summary, so the cause is
  diagnosable from CI logs alone. The live progress line also now routes
  permission failures through the same grant-scope guidance as the terminal
  summary, and unexpected throws print their `cause` chain instead of a static
  `unexpected error` marker.

- [#488](https://github.com/christopher-buss/bedrock/pull/488) [`508119c`](https://github.com/christopher-buss/bedrock/commit/508119c5b14a58599a6c9175e3ae87008f5398bb) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Abort the two-phase rebuild when the asset stage fails. A deploy whose asset stage could not apply or persist now surfaces that failure (`applyFailed` / `stateWriteFailed`) instead of invoking the rebuild hook and republishing over half-applied state, so an asset-stage error is no longer masked behind a later republish result.

- Updated dependencies [[`1a12607`](https://github.com/christopher-buss/bedrock/commit/1a12607219e843249bf3f9e326586a57528577ca), [`cab8151`](https://github.com/christopher-buss/bedrock/commit/cab81510cd38b108e74f844e802d209fd1c4766b), [`b36a6eb`](https://github.com/christopher-buss/bedrock/commit/b36a6ebf5ea51f278afe147895041b98001342ad), [`05a1b49`](https://github.com/christopher-buss/bedrock/commit/05a1b49f1f3eee5a196bec185ebe6ac76294daa0), [`fe924a2`](https://github.com/christopher-buss/bedrock/commit/fe924a29a396cd67c9b3dfa3c33bf52841696540)]:
  - @bedrock-rbx/ocale@0.1.0
