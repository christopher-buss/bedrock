# ADR-037: Config editing for import

Date: 2026-11-13 Status: Accepted

## Splice import entries into plain literals, or print them to paste

`bedrock import` writes config changes: new root entries, `importId` and
`iconBaseline` overlay lines, and `retired: "untrack"`. A config file is the
user's own source. It can carry comments, a chosen order and style, and computed
values. Writing an entry must keep all of that, must never produce a config that
means something other than what the import planned, and must not cost `deploy`
or `diff` anything.

We edit text in place, one entry at a time, only where that entry's location is
a plain literal: a literal object in TS/JS, a JSON object, or a block mapping in
YAML. Everywhere else (a spread, a computed key or value, a function export, a
Luau config, a YAML flow map, anchor, alias, tag, block scalar or merge key) the
editor returns the entry as "not safe", with text to paste and where to paste
it. One unsafe entry does not block the safe entries in the same file.

- **TS, JS and JSON** are parsed with `oxc-parser`. JSON is parsed as a JS
  expression. The editor uses source spans only and splices text; it never
  prints the AST.
- **YAML** is read with a small indent-aware scanner that finds the mapping, key
  and value ranges. After each write, the new text is parsed with `confbox`
  (js-yaml) and compared with the expected value; a mismatch turns the edit into
  paste text. bedrock keeps one YAML implementation: c12 and `confbox` already
  load config through js-yaml.
- **Loading.** The editor is imported lazily by `bedrock import`, so the CLI
  start and `deploy`/`diff` do not load `oxc-parser`.

## Considered Options

Approaches:

- **Splice at plain literals, else paste text.** Chosen.
- **Rewrite the whole file**, as `bedrock migrate` serializes a new config.
  Loses comments, order and computed values in files the user wrote by hand.
- **Print only.** Safe and simple, but every import becomes manual work, and
  most configs are plain literals that can be edited safely.
- **Parse, change and re-print the AST** (recast or magicast style). Re-printing
  changes formatting outside the edited entry, and needs a second parser stack.

TS/JS parsers:

- **`oxc-parser`.** Chosen. It is the parser of the oxc toolchain the repo
  already builds and lints with, parses TS and JS in one call, and gives UTF-16
  spans for splicing.
- **magicast.** Built for config-file edits, but on recast and Babel: it
  re-prints edited nodes and adds a second parser stack.
- **Babel with recast.** Same objections as magicast, without its config
  helpers.
- **TypeScript compiler API.** Too large for a runtime dependency.

YAML:

- **The `yaml` package** gives source ranges directly, but it is a second YAML
  parser next to js-yaml, larger to install, and slower to import and parse.
  This is why bedrock uses `confbox` for config loading. Rejected.

## Criteria

1. Keep the user's formatting: comments, order and style outside the changed
   entry stay the same.
2. Never write a wrong config: when the editor is not sure, it gives paste text;
   YAML writes are verified by parsing them again.
3. No cost to `deploy` and `diff`: small install size, editor loaded only by
   `bedrock import`.
4. Reuse the current toolchain: oxc and `confbox`/js-yaml; no second parser for
   one format.

## Consequences

- `@bedrock-rbx/core` gains a runtime dependency on `oxc-parser`, a native
  binding with per-platform packages and a pre-1.0 version line.
- bedrock maintains its own YAML scanner. Its scope stays small because any
  construct it does not model becomes paste text, and every write is checked
  with js-yaml.
- Luau configs, computed TS/JS locations and YAML flow maps always need a manual
  paste. The CLI prints where each entry goes.
- Quoting in written YAML follows bedrock's own scalar rules, not a library's
  `stringify`.

This extends [ADR-035](035-live-state-out-of-band-edits-and-import.md), which
defines Import and the `importId` and `iconBaseline` declarations the editor
writes.
