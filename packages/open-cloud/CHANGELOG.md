# @bedrock-rbx/ocale

## 0.1.0

### Minor Changes

- [#486](https://github.com/christopher-buss/bedrock/pull/486) [`1a12607`](https://github.com/christopher-buss/bedrock/commit/1a12607219e843249bf3f9e326586a57528577ca) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Adapt rate-limit pacing to the live remaining budget. The client now reads `x-ratelimit-remaining` / `x-ratelimit-reset` off every response and, per API key, spaces requests across the live window (holding until reset once the budget is spent) instead of relying only on the static, schema-derived per-operation limits and reactive 429 handling. A sibling operation on the same key can pre-empt a 429 the static bucket cannot foresee; the static token bucket remains the cold-start and header-absent fallback. `RateLimitError` gains a `remaining` field carrying the exhausted-budget signal from a 429, and multi-window `x-ratelimit-reset` values are parsed correctly.

### Patch Changes

- [#482](https://github.com/christopher-buss/bedrock/pull/482) [`b36a6eb`](https://github.com/christopher-buss/bedrock/commit/b36a6ebf5ea51f278afe147895041b98001342ad) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Initial 0.1.0 stable release. Graduates the package from the `0.1.0-beta` line to a stable, semver-tracked release with a published changelog and provenance.

- [#492](https://github.com/christopher-buss/bedrock/pull/492) [`05a1b49`](https://github.com/christopher-buss/bedrock/commit/05a1b49f1f3eee5a196bec185ebe6ac76294daa0) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Correct package documentation and publish metadata for the first release: fix the README quick-start examples to match the real config and client APIs, ship a LICENSE file inside each package, and repair the ocale package repository link.

- [#495](https://github.com/christopher-buss/bedrock/pull/495) [`fe924a2`](https://github.com/christopher-buss/bedrock/commit/fe924a29a396cd67c9b3dfa3c33bf52841696540) Thanks [@christopher-buss](https://github.com/christopher-buss)! - Document the introducing version of every public symbol with a JSDoc `@since 0.1.0` tag, now surfaced in the API docs and IDE hovers.
