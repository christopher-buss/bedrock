# ADR-001 Bun Runtime Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task.

**Goal:** Align project configuration with ADR-001 (TypeScript with Bun Runtime)

**Architecture:** Replace Node.js runtime references with Bun, add Bun types,
configure binary compilation for dual distribution (npm + standalone binary)

**Tech Stack:** Bun 1.x, TypeScript, pnpm (unchanged), tsdown (evaluate)

---

## Summary of Changes

| Area      | Current         | Target                              |
| --------- | --------------- | ----------------------------------- |
| Engine    | `node >=20.0.0` | `bun >=1.0.0`                       |
| TS Runner | `tsx`           | `bun` (native)                      |
| Types     | `@types/node`   | `@types/bun` (includes Node compat) |
| Stdlib    | Default TS lib  | `better-typescript-lib` (stricter)  |
| Binary    | None            | `bun build --compile`               |

---

### Task 1: Add Bun Types

**Files:**

- Modify: `pnpm-workspace.yaml` (add bun types to catalog)
- Modify: `package.json` (add @types/bun dependency)

**Step 1: Add @types/bun to catalog**

In `pnpm-workspace.yaml`, add to the `types` catalog:

```yaml
types:
  "@isentinel/tsconfig": 1.0.0
  "@types/bun": 1.2.10
```

Note: Remove `@types/node` - Bun includes Node.js-compatible types. Having both
causes type conflicts.

**Step 2: Update package.json devDependencies**

In `package.json`, replace `@types/node` with `@types/bun`:

```json
{
	"@types/bun": "catalog:types"
}
```

And remove the `@types/node` line.

**Step 3: Install dependencies**

Run: `pnpm install` Expected: Lock file updated, @types/bun installed

**Step 4: Verify types work**

Run: `pnpm typecheck` Expected: PASS (no type errors)

**Step 5: Commit**

```bash
git add pnpm-workspace.yaml package.json pnpm-lock.yaml
git commit -m "chore: add @types/bun for Bun runtime support"
```

---

### Task 2: Add better-typescript-lib

**Why:** TypeScript's default stdlib uses `any` extensively (e.g.,
`JSON.parse()` returns `any`). `better-typescript-lib` replaces these with
stricter types, catching bugs at compile time.

**Files:**

- Modify: `pnpm-workspace.yaml` (add to catalog)
- Modify: `package.json` (add dependency)
- Modify: `tsconfig.json` (enable libReplacement)
- Create: `.npmrc` (pnpm hoisting config)

**Step 1: Add to catalog**

In `pnpm-workspace.yaml`, add to the `types` catalog:

```yaml
types:
  "@isentinel/tsconfig": 1.0.0
  "@types/bun": 1.2.10
  better-typescript-lib: 2.12.0
```

**Step 2: Add to package.json**

In `package.json`, add to devDependencies:

```json
{
	"better-typescript-lib": "catalog:types"
}
```

**Step 3: Create .npmrc for pnpm hoisting**

Create `.npmrc` with:

```ini
public-hoist-pattern[]=@typescript/*
```

This allows better-typescript-lib to override TypeScript's built-in types.

**Step 4: Enable libReplacement in tsconfig.json**

In `tsconfig.json`, add to compilerOptions:

```json
{
	"compilerOptions": {
		"libReplacement": true
	}
}
```

**Step 5: Install and verify**

Run: `pnpm install`

Run: `pnpm typecheck` Expected: PASS (may surface new type errors to fix)

**Step 6: Commit**

```bash
git add pnpm-workspace.yaml package.json tsconfig.json .npmrc pnpm-lock.yaml
git commit -m "chore: add better-typescript-lib for stricter stdlib types"
```

---

### Task 3: Update Engine Requirement

**Files:**

- Modify: `package.json` (change engines field)

**Step 1: Change engine from node to bun**

In `package.json`, replace:

```json
{
	"engines": {
		"node": ">=20.0.0"
	}
}
```

With:

```json
{
	"engines": {
		"bun": ">=1.0.0"
	}
}
```

**Step 2: Verify package.json is valid**

Run: `cat package.json | jq .engines` Expected: `{ "bun": ">=1.0.0" }`

**Step 3: Commit**

```bash
git add package.json
git commit -m "chore: require Bun 1.x runtime instead of Node.js"
```

---

### Task 4: Remove tsx Dependency

**Files:**

- Modify: `pnpm-workspace.yaml` (remove tsx from catalog)
- Modify: `package.json` (remove tsx dependency, update start script)

**Step 1: Remove tsx from catalog**

In `pnpm-workspace.yaml`, remove this line from the `cli` catalog:

```yaml
tsx: 4.21.0
```

**Step 2: Remove tsx from package.json**

In `package.json`, remove from devDependencies:

```json
{
	"tsx": "catalog:cli"
}
```

**Step 3: Update start script to use bun**

In `package.json`, change the start script from:

```json
{
	"start": "tsx src/index.ts"
}
```

To:

```json
{
	"start": "bun run src/index.ts"
}
```

**Step 4: Install to update lock file**

Run: `pnpm install` Expected: tsx removed from lock file

**Step 5: Verify start script works**

Run: `pnpm start` Expected: Script executes without error (currently empty
export, should exit cleanly)

**Step 6: Commit**

```bash
git add pnpm-workspace.yaml package.json pnpm-lock.yaml
git commit -m "chore: replace tsx with native Bun TypeScript execution"
```

---

### Task 5: Add Binary Compilation Script

**Files:**

- Modify: `package.json` (add build:binary script)

**Step 1: Add binary build script**

In `package.json`, add to scripts:

```json
{
	"build:binary": "bun build src/index.ts --compile --outfile dist/bedrock"
}
```

**Step 2: Verify binary builds**

Run: `pnpm build:binary` Expected: Creates `dist/bedrock` executable (~57MB per
ADR-001)

**Step 3: Test binary executes**

Run: `./dist/bedrock` Expected: Runs without error (currently empty, exits
cleanly)

**Step 4: Update .gitignore if needed**

Verify `dist/` is in `.gitignore` (binary should not be committed)

**Step 5: Commit**

```bash
git add package.json
git commit -m "feat: add binary compilation via bun build --compile"
```

---

### Task 6: Evaluate tsdown vs Bun Build

**Context:** ADR-001 mentions `bun build --compile` for binaries. Currently
using tsdown for library build. Need to decide if both are needed or if we
should consolidate.

**Step 1: Research both tools**

Investigate and document:

| Aspect             | tsdown | bun build |
| ------------------ | ------ | --------- |
| ESM output         | ?      | ?         |
| CJS output         | ?      | ?         |
| `.d.ts` generation | ?      | ?         |
| Binary compilation | ?      | ?         |
| Bundle size        | ?      | ?         |
| Build speed        | ?      | ?         |
| Tree shaking       | ?      | ?         |

**Step 2: Test both build approaches**

Run: `pnpm build && ls -la dist/` Document: Output files, sizes, formats

Run: `bun build src/index.ts --outdir dist-bun --target bun` Document: Output
files, sizes, formats

Run: `pnpm build:binary && ls -la dist/bedrock` Document: Binary size

**Step 3: Present findings to user**

Summarize findings and present options:

1. **Keep both tools** - tsdown for npm, bun build for binary
2. **Consolidate to bun build** - If it can generate .d.ts and ESM
3. **Consolidate to tsdown** - If it can create binaries (unlikely)
4. **Other** - User's preference

Ask user: "Based on these findings, which approach do you prefer?"

**Step 4: Document the decision**

Based on user's choice, create or update documentation:

- If significant: Create `docs/adr/00X-build-tooling.md`
- If minor: Add comment in `package.json` scripts section

**Step 5: Implement chosen approach**

Update `package.json` scripts based on decision:

- Remove unused build tool if consolidating
- Update script names for clarity
- Ensure both npm and binary distribution work

**Step 6: Verify and commit**

Run: `pnpm build` (npm distribution) Run: `pnpm build:binary` (standalone
binary)

```bash
git add package.json pnpm-workspace.yaml docs/
git commit -m "chore: finalize build tooling based on evaluation"
```

---

### Task 7: Clean Up Unused Dependencies (Optional)

**Files:**

- Review: `package.json` for any Node.js-specific dependencies no longer needed

**Step 1: Audit current dependencies**

Review devDependencies for Node.js-specific tools:

- `@antfu/ni` - Keep (package manager wrapper, works with Bun)
- `jiti` - Evaluate (TypeScript config loader, Bun has native support)

**Step 2: Test without jiti**

If ESLint/other configs work with Bun's native TS support, jiti may be
removable. This is optional - defer if not blocking.

---

## Verification Checklist

After all tasks complete, verify:

- [ ] `pnpm typecheck` passes with Bun types
- [ ] `pnpm start` runs using Bun (not tsx)
- [ ] `pnpm build` generates npm package files
- [ ] `pnpm build:binary` generates standalone executable
- [ ] `./dist/bedrock` runs without Node.js installed
- [ ] `package.json` engines field requires Bun 1.x

---

## Not In Scope (Per ADR-002)

The following will be addressed when implementing ADR-002 (Monorepo):

- Turborepo setup
- Package restructuring to `packages/cli`, `packages/open-cloud`
- Workspace configuration updates
