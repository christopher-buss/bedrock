# @bedrock/typescript-config

Shared TypeScript configuration for all Bedrock packages.

## Known Workarounds

### `dom-iterable.d.ts` — Missing Headers iteration types

`better-typescript-lib@2.12.0` splits DOM types across `index.d.ts` (base
methods) and `iterable.d.ts` (iterator methods). tsgo's `libReplacement: true`
only loads `index.d.ts`, so `Headers.entries()`, `Headers.keys()`,
`Headers.values()`, and `for...of` on `Headers` are untyped.

`dom-iterable.d.ts` augments the global `Headers` interface with these missing
methods. It is included via the `"files"` field in `tsconfig.base.json`.

**When to update:** If you encounter similar missing iterable methods on other
DOM types (e.g., `URLSearchParams`, `FormData`), add their augmentations to the
same file.

**When to remove:** If `better-typescript-lib` ships a fix, or if the project
drops `better-typescript-lib` in favor of TS6+ standard lib types (which already
include iterables in `lib.dom.d.ts`).
