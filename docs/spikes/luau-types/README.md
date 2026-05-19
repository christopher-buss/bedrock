# Luau type spike

Feasibility evidence for [ADR-025: Luau type definitions for bedrock.config.luau](../../adr/025-luau-type-definitions.md).

The single file [`spike.luau`](./spike.luau) consolidates every encoding pattern explored during the feasibility work, in 11 numbered sections. Each section is either a chosen pattern or a rejected alternative; the comment block at the top of each section names which.

## Running

```bash
mise use luau@0.689  # once per session
lute check spike.luau
```

Or open `spike.luau` in your editor with luau-lsp enabled and hover the lines marked `EXPECT ERROR` to see each section's diagnostic inline.

`luau-analyze` 0.689 does not support user-defined type functions; `lute check` is the only working analyser.

## Section map

| Section | Topic | Outcome |
| --- | --- | --- |
| 1 | `types.error('msg')` inside a type function | Rejected (API not exposed in toolchain) |
| 2 | Plain `error('msg')` inside a type function | Rejected (framing too noisy) |
| 3 | Singleton-string optional property | Chosen encoding for directive-bearing fields |
| 4 | `never?` optional | Control (clean but uninformative) |
| 5 | Singleton + brand intersection | Rejected (extra noise, no added protection) |
| 6 | Type-function structural guard | Rejected (indexer collapses per-key shape) |
| 7 | Top-level `Config` union, invalid config | Demonstrates the fan-out problem |
| 8 | Top-level `Config` union, VALID configs | Critical finding: fan-out fires on valid configs too |
| 9 | Variant-pinned annotation | Chosen baseline for clean directive diagnostics |
| 10 | Top-level `mode` discriminator field | Rejected (schema-change workaround for a transient solver limitation) |
| 11 | Fluent `expectTypeOf().toEqualTypeOf()` API | Rejected (silently passes regardless of mismatch) |

Sections 3 and 9 are the patterns the future-tightened Luau types will use once [luau-lang/luau#2205](https://github.com/luau-lang/luau/issues/2205) closes. Sections 7, 8, 10, and 11 are the alternatives ADR-025 rejects.

## Related context

- ADR-025: [docs/adr/025-luau-type-definitions.md](../../adr/025-luau-type-definitions.md)
- PRD: [christopher-buss/bedrock#441](https://github.com/christopher-buss/bedrock/issues/441)
- Upstream Luau issue: [luau-lang/luau#2205](https://github.com/luau-lang/luau/issues/2205)
