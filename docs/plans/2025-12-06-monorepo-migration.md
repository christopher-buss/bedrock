# Monorepo Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task.

**Goal:** Convert Bedrock from single-package to Turborepo monorepo with FCIS +
Ports architecture per ADR-002.

**Architecture:** Turborepo orchestrates `packages/cli` (main CLI),
`packages/open-cloud` (Roblox API client), `apps/website` (docs), and `apps/e2e`
(scenario tests). Each package follows FCIS pattern with `core/`, `shell/`,
`ports/`, `adapters/` directories.

**Tech Stack:** Turborepo, pnpm workspaces, tsdown, vitest, TypeScript

---

## Task 1: Create turbo.json

**Files:**

- Create: `turbo.json`

**Step 1: Create turbo.json**

```json
{
	"$schema": "https://turborepo.org/schema.json",
	"ui": "tui",
	"tasks": {
		"build": {
			"dependsOn": ["^build"],
			"outputs": ["dist/**"],
			"outputMode": "new-only"
		},
		"dev": {
			"cache": false,
			"persistent": true
		},
		"test": {
			"outputs": ["coverage/**"],
			"outputMode": "new-only"
		},
		"lint": {
			"outputMode": "new-only"
		},
		"typecheck": {
			"dependsOn": ["^build"],
			"outputMode": "new-only"
		}
	}
}
```

**Step 2: Commit**

```bash
git add turbo.json
git commit -m "chore: add turbo.json for monorepo orchestration"
```

---

## Task 2: Update pnpm-workspace.yaml

**Files:**

- Modify: `pnpm-workspace.yaml:1-2`

**Step 1: Update packages field**

Change lines 1-2 from:

```yaml
packages:
    - src/*
```

To:

```yaml
packages:
    - "packages/*"
    - "apps/*"
```

**Step 2: Commit**

```bash
git add pnpm-workspace.yaml
git commit -m "chore: update workspace packages to packages/* and apps/*"
```

---

## Task 3: Create directory structure with .gitkeep files

**Files:**

- Create directories with .gitkeep placeholders

**Step 1: Create all directories**

```bash
mkdir -p packages/cli/src/{core,shell,ports,adapters,types}
mkdir -p packages/cli/tests/{unit,integration,fakes,factories}
mkdir -p packages/open-cloud/src/{core,adapters,ports,types}
mkdir -p packages/open-cloud/tests/{unit,adapters}
mkdir -p apps/website/docs
mkdir -p apps/e2e/tests/scenarios
```

**Step 2: Add .gitkeep files to empty directories**

```bash
touch packages/cli/src/core/.gitkeep
touch packages/cli/src/shell/.gitkeep
touch packages/cli/src/ports/.gitkeep
touch packages/cli/src/adapters/.gitkeep
touch packages/cli/src/types/.gitkeep
touch packages/cli/tests/unit/.gitkeep
touch packages/cli/tests/integration/.gitkeep
touch packages/cli/tests/fakes/.gitkeep
touch packages/cli/tests/factories/.gitkeep
touch packages/open-cloud/src/core/.gitkeep
touch packages/open-cloud/src/adapters/.gitkeep
touch packages/open-cloud/src/ports/.gitkeep
touch packages/open-cloud/src/types/.gitkeep
touch packages/open-cloud/tests/unit/.gitkeep
touch packages/open-cloud/tests/adapters/.gitkeep
touch apps/website/docs/.gitkeep
touch apps/e2e/tests/scenarios/.gitkeep
```

**Step 3: Verify structure**

```bash
ls -la packages/
ls -la apps/
```

Expected: `cli` and `open-cloud` under packages, `website` and `e2e` under apps

**Step 4: Commit directory structure**

```bash
git add packages/ apps/
git commit -m "chore: create monorepo directory structure with .gitkeep files"
```

---

## Task 4: Create @bedrock/open-cloud package.json

**Files:**

- Create: `packages/open-cloud/package.json`

**Step 1: Create package.json**

```json
{
	"name": "@bedrock/open-cloud",
	"version": "0.0.1",
	"description": "Roblox Open Cloud API client",
	"type": "module",
	"exports": {
		".": {
			"import": "./dist/index.mjs",
			"types": "./dist/index.d.mts"
		}
	},
	"main": "./dist/index.mjs",
	"types": "./dist/index.d.mts",
	"files": ["dist"],
	"scripts": {
		"build": "tsdown --clean --dts",
		"dev": "tsdown --stub",
		"test": "vitest",
		"lint": "eslint --cache src tests",
		"typecheck": "tsc --noEmit"
	},
	"devDependencies": {
		"@types/bun": "catalog:types",
		"tsdown": "catalog:cli",
		"typescript": "catalog:typescript",
		"vitest": "catalog:testing"
	}
}
```

---

## Task 5: Create @bedrock/open-cloud tsconfig.json

**Files:**

- Create: `packages/open-cloud/tsconfig.json`

**Step 1: Create tsconfig.json**

```json
{
	"extends": "../../tsconfig.json",
	"compilerOptions": {
		"outDir": "./dist",
		"rootDir": "./src"
	},
	"include": ["src"],
	"exclude": ["node_modules", "dist", "tests"]
}
```

---

## Task 6: Create @bedrock/open-cloud tsdown.config.ts

**Files:**

- Create: `packages/open-cloud/tsdown.config.ts`

**Step 1: Create tsdown.config.ts**

```typescript
import { defineConfig } from "tsdown";

export default defineConfig({
	clean: true,
	entry: ["src/index.ts"],
	fixedExtension: true,
	format: ["esm"],
	publint: true,
	shims: true,
	unused: { level: "error" },
});
```

---

## Task 7: Create @bedrock/open-cloud entry point

**Files:**

- Create: `packages/open-cloud/src/index.ts`

**Step 1: Create index.ts**

```typescript
export {};
```

**Step 2: Commit open-cloud package**

```bash
git add packages/open-cloud/
git commit -m "chore: add @bedrock/open-cloud package scaffold"
```

---

## Task 8: Create CLI package.json

**Files:**

- Create: `packages/cli/package.json`

**Step 1: Create package.json**

```json
{
	"name": "bedrock",
	"version": "0.0.1",
	"description": "Infrastructure-as-Code deployment tool for Roblox",
	"type": "module",
	"exports": {
		".": {
			"import": "./dist/index.mjs",
			"types": "./dist/index.d.mts"
		}
	},
	"main": "./dist/index.mjs",
	"types": "./dist/index.d.mts",
	"files": ["dist"],
	"scripts": {
		"build": "tsdown --clean --dts",
		"dev": "tsdown --stub",
		"test": "vitest",
		"lint": "eslint --cache src tests",
		"typecheck": "tsc --noEmit"
	},
	"dependencies": {
		"@bedrock/open-cloud": "workspace:*"
	},
	"devDependencies": {
		"@types/bun": "catalog:types",
		"tsdown": "catalog:cli",
		"typescript": "catalog:typescript",
		"vitest": "catalog:testing"
	}
}
```

---

## Task 9: Create CLI tsconfig.json

**Files:**

- Create: `packages/cli/tsconfig.json`

**Step 1: Create tsconfig.json**

```json
{
	"extends": "../../tsconfig.json",
	"compilerOptions": {
		"outDir": "./dist",
		"rootDir": "./src"
	},
	"include": ["src"],
	"exclude": ["node_modules", "dist", "tests"]
}
```

---

## Task 10: Create CLI tsdown.config.ts

**Files:**

- Create: `packages/cli/tsdown.config.ts`

**Step 1: Create tsdown.config.ts**

```typescript
import { defineConfig } from "tsdown";

export default defineConfig({
	clean: true,
	entry: ["src/index.ts"],
	fixedExtension: true,
	format: ["esm"],
	publint: true,
	shims: true,
	unused: { level: "error" },
});
```

---

## Task 11: Create CLI entry point

**Files:**

- Create: `packages/cli/src/index.ts`

**Step 1: Create index.ts**

```typescript
export {};
```

**Step 2: Commit CLI package**

```bash
git add packages/cli/
git commit -m "chore: add bedrock CLI package scaffold"
```

---

## Task 12: Create website package.json

**Files:**

- Create: `apps/website/package.json`

**Step 1: Create package.json**

```json
{
	"name": "@bedrock/website",
	"version": "0.0.1",
	"private": true,
	"description": "Bedrock documentation website",
	"type": "module",
	"scripts": {
		"dev": "vitepress dev",
		"build": "vitepress build",
		"preview": "vitepress preview"
	},
	"devDependencies": {
		"vitepress": "^1.5.0"
	}
}
```

**Step 2: Commit website package**

```bash
git add apps/website/
git commit -m "chore: add @bedrock/website package scaffold"
```

---

## Task 13: Create e2e package.json

**Files:**

- Create: `apps/e2e/package.json`

**Step 1: Create package.json**

```json
{
	"name": "@bedrock/e2e",
	"version": "0.0.1",
	"private": true,
	"description": "Bedrock E2E scenario tests",
	"type": "module",
	"scripts": {
		"test": "vitest"
	},
	"dependencies": {
		"@bedrock/open-cloud": "workspace:*",
		"bedrock": "workspace:*"
	},
	"devDependencies": {
		"vitest": "catalog:testing"
	}
}
```

**Step 2: Commit e2e package**

```bash
git add apps/e2e/
git commit -m "chore: add @bedrock/e2e package scaffold"
```

---

## Task 14: Update root package.json

**Files:**

- Modify: `package.json`

**Step 1: Remove single-package fields**

Remove these fields entirely:

- `sideEffects` (line 19)
- `exports` (lines 21-24)
- `main` (line 25)
- `module` (line 26)
- `types` (line 27)
- `files` (lines 28-30)

**Step 2: Update scripts**

Replace scripts section with:

```json
{
	"scripts": {
		"build": "turbo build",
		"dev": "turbo dev",
		"test": "turbo test",
		"lint": "turbo lint",
		"lint:ci": "turbo lint -- --cache-strategy content",
		"typecheck": "turbo typecheck",
		"release": "bumpp"
	}
}
```

**Step 3: Commit**

```bash
git add package.json
git commit -m "chore: update root package.json for monorepo"
```

---

## Task 15: Update root tsconfig.json

**Files:**

- Modify: `tsconfig.json`

**Step 1: Replace tsconfig.json content**

```json
{
	"extends": "@isentinel/tsconfig/typescript",
	"compilerOptions": {
		"libReplacement": true,
		"baseUrl": ".",
		"paths": {
			"@bedrock/open-cloud": ["packages/open-cloud/src"],
			"@bedrock/open-cloud/*": ["packages/open-cloud/src/*"]
		},
		"types": ["bun"]
	},
	"exclude": ["node_modules", "dist", "packages", "apps"]
}
```

**Step 2: Commit**

```bash
git add tsconfig.json
git commit -m "chore: update tsconfig.json with workspace path mappings"
```

---

## Task 16: Remove old files

**Files:**

- Delete: `src/index.ts`
- Delete: `src/` directory
- Delete: `tsdown.config.ts`

**Step 1: Remove files**

```bash
rm -rf src/
rm tsdown.config.ts
```

**Step 2: Commit**

```bash
git add -A
git commit -m "chore: remove old single-package structure"
```

---

## Task 17: Install dependencies and verify

**Step 1: Install dependencies**

```bash
pnpm install
```

Expected: Success, no errors

**Step 2: Run build**

```bash
pnpm build
```

Expected: All packages build successfully

**Step 3: Run lint**

```bash
pnpm lint
```

Expected: No errors

**Step 4: Run typecheck**

```bash
pnpm typecheck
```

Expected: No errors

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: complete monorepo migration (ADR-002)"
```

---

## Verification Checklist

- [ ] `turbo.json` exists and defines task pipelines
- [ ] `pnpm-workspace.yaml` points to `packages/*` and `apps/*`
- [ ] `pnpm install` succeeds
- [ ] `pnpm build` builds all packages
- [ ] `pnpm lint` passes
- [ ] `pnpm typecheck` passes
- [ ] `@bedrock/open-cloud` dependency works in CLI package
