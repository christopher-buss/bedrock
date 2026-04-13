# ADR-013 hk Git Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `simple-git-hooks` + `lint-staged` with **hk**, wiring a differentiated gate that runs comprehensive checks (typecheck + test + build) at pre-commit time for AI-generated commits and at pre-push time for humans.

**Architecture:** hk is installed via mise (same ecosystem as existing Bun/Node). Config lives in `hk.pkl` (Pkl format). Agent detection uses `std-env`'s `isAgent` export, called from a small Bun script (`scripts/is-agent.ts`). Heavy gate steps are conditioned on that script's output. Lint continues to run on every commit; everything else is differentiated.

**Tech Stack:** hk (via mise), Pkl (config), `std-env` (agent detection), `@commitlint/cli` + `@commitlint/config-conventional`, Turborepo 2.1+ `--affected` flag, Bun runtime.

---

## Prerequisites

ADR-013 is **Accepted** (as of 2026-04-13). Implementation may begin. The ADR's Pkl example already uses `bun scripts/is-agent.ts`, matching what this plan implements.

**Execution location:** Prefer a dedicated git worktree off `main` for this work (see `superpowers:using-git-worktrees`). The task is self-contained and non-trivial; isolating it from any in-flight feature work avoids cross-contamination of the hook configuration. If the plan is being executed inline on `docs/adr-013-hk-git-hooks` (the current branch), that is also acceptable — but if the worktree approach is used, create it from `main`, not from this branch.

**Verification-at-implementation-time items** (things to confirm against current hk docs before assuming the plan text is correct):

1. **hk install command.** The plan uses `hk install` as the hook-registration command. Confirm this is the current command against <https://hk.jdx.dev/> before running it. If the command has changed, update the plan and proceed.
2. **hk schema URL version.** The plan pins hk at `v1.38.0` (matching the schema URL in the Pkl import). Confirm a compatible current release exists before writing `hk.pkl`; if a newer minor/patch is available and the schema is backward-compatible, pin to the latest. If a major version bumped the schema, pause and re-validate the config shape.
3. **Turborepo `--affected` base ref.** Turbo 2.1+ infers the base ref automatically for `--affected`. Confirm this works with bedrock's `turbo.json` without explicit `globalDependencies` changes. If it fails, add `--filter=[main]` as a fallback to the `:affected` scripts.

---

## Summary of Changes

| Area                 | Current                                               | Target                                                                     |
| -------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| Hook manager         | `simple-git-hooks` + `lint-staged`                    | `hk` (via mise)                                                            |
| Hook config          | `"simple-git-hooks"` field in `package.json`          | `hk.pkl` at repo root                                                      |
| Pre-commit (human)   | `pnpm i ... && npx lint-staged` (ESLint only)         | Guards + ESLint on staged files                                            |
| Pre-commit (AI)      | Same as human                                         | Guards + ESLint + typecheck + test + build (all `:affected`)               |
| Pre-push             | Nothing                                               | typecheck + test + build (unconditional)                                   |
| Commit message       | Advisory Conventional Commits                         | Enforced via `commit-msg` hook calling `commitlint`                        |
| Post-merge           | Nothing                                               | Auto-runs `pnpm install` on lockfile change, `mise install` on mise.toml change |
| CI                   | Individual `lint → typecheck → build → test` steps  | Single `hk check` invocation                                               |
| `:affected` scripts  | None                                                  | `typecheck:affected`, `test:affected`, `build:affected`                    |

---

## File Structure

**New files:**

- `hk.pkl` — hk configuration (Pkl format)
- `scripts/is-agent.ts` — prints `"true"` or `"false"` based on `std-env`'s `isAgent`
- `commitlint.config.ts` — commitlint configuration extending conventional config

**Modified files:**

- `package.json` — add `:affected` scripts; remove `simple-git-hooks` / `lint-staged` fields and devDependencies; add `std-env`, `@commitlint/cli`, `@commitlint/config-conventional` devDependencies
- `pnpm-workspace.yaml` — add `std-env` and commitlint packages to catalog(s) if the project uses catalog entries consistently (verify against the file at implementation time)
- `mise.toml` — add `hk` under `[tools]`
- `.github/workflows/ci.yaml` — replace individual quality-gate steps with a single `hk check` step
**Out of scope for this plan (deliberate exclusions):**

- `prepare-commit-msg` hook and commit-message template script. The ADR mentions this as part of the full hk hook surface, but the template behavior is not specified and is orthogonal to the differentiated gate. Add later if desired.
- `lint:affected` script. `lint` is already fast; `pnpm lint` stays as-is.
- Windows contributor validation. The `shell = "bash -c"` incantation is included for forward compatibility, but validation on Windows is not part of this plan.

---

## Task 1: Add `:affected` Pnpm Scripts

**Why first:** These scripts have zero dependency on hk and can be validated independently. Getting them working first means the later hk steps reference commands we already know work.

**Files:**

- Modify: `package.json` (add three scripts)

- [ ] **Step 1: Add the scripts to `package.json`**

Open `package.json`. In the `"scripts"` block, alongside the existing `build`/`test`/`typecheck` entries, add:

```json
{
	"scripts": {
		"build": "turbo build",
		"build:affected": "turbo run build --affected",
		"test": "vitest run",
		"test:affected": "turbo run test --affected",
		"typecheck": "turbo typecheck",
		"typecheck:affected": "turbo run typecheck --affected"
	}
}
```

Keep all other existing scripts unchanged. Do not reorder unrelated keys.

- [ ] **Step 2: Verify `typecheck:affected` runs**

Run:

```bash
pnpm typecheck:affected
```

Expected: the command succeeds (exit 0). If bedrock has no changes vs. the merge base, Turbo will report "No packages matched the provided filters" or similar and exit cleanly. If it errors with "unknown flag --affected," confirm Turbo is ≥ 2.1 (`pnpm turbo --version`) and upgrade if needed.

- [ ] **Step 3: Verify `test:affected` runs**

Run:

```bash
pnpm test:affected
```

Expected: exit 0. Same semantics as above.

- [ ] **Step 4: Verify `build:affected` runs**

Run:

```bash
pnpm build:affected
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "build: add turbo --affected pnpm scripts"
```

---

## Task 2: Install hk via mise

**Files:**

- Modify: `mise.toml` (add `hk`)

- [ ] **Step 1: Add hk to `mise.toml`**

Open `mise.toml`. In the `[tools]` section, add `hk` pinned to a version whose Pkl schema is backward-compatible with `v1.38.0`. Example (verify the latest compatible version at implementation time):

```toml
[tools]
bun = "1.3.4"
node = { version = "lts", postinstall = "corepack enable" }
"npm:vercel" = "latest"
hk = "1.38.0"
```

If mise's registry uses a different identifier for hk (e.g. `ubi:jdx/hk` or similar), use that instead. Check `mise registry | grep -i hk` first.

- [ ] **Step 2: Install the new tool**

Run:

```bash
mise install
```

Expected: mise downloads and installs hk. No errors.

- [ ] **Step 3: Verify hk is on PATH**

Run:

```bash
hk --version
```

Expected: prints an hk version string (e.g. `hk 1.38.0`).

- [ ] **Step 4: Commit**

```bash
git add mise.toml
git commit -m "build(deps): add hk to mise tools"
```

---

## Task 3: Create Agent-Detection Script

**Why Bun:** ADR-001 establishes Bun as the runtime. Bun can execute `.ts` files directly with no transpile step, and mise already puts `bun` on PATH. Using `bun` also avoids spawning a Node process from within an hk step that is otherwise running inside a Bun-managed repo. ADR-013 already documents this choice in its Pkl example.

**Files:**

- Modify: `package.json` (add `std-env` dev dep)
- Modify: `pnpm-workspace.yaml` (add `std-env` to catalog if using catalogs consistently — verify at implementation time)
- Create: `scripts/is-agent.ts`

- [ ] **Step 1: Add `std-env` as a dev dependency**

Run:

```bash
pnpm add -D -w std-env
```

Expected: `std-env` is added to the root `package.json` `devDependencies`. If the repo uses pnpm catalogs for devDependencies (check `pnpm-workspace.yaml`'s existing catalog entries), also add `std-env` to the appropriate catalog and reference it as `"std-env": "catalog:..."`.

- [ ] **Step 2: Write the agent-detection script**

Create `scripts/is-agent.ts` with exactly this content:

```ts
import { isAgent } from "std-env";

console.log(isAgent ? "true" : "false");
```

No additional logic. No argv parsing. No error handling. The script's only job is to print the boolean status of `isAgent` on stdout.

- [ ] **Step 3: Verify the script in the human path**

Run:

```bash
bun scripts/is-agent.ts
```

Expected output: `false`

(Your interactive shell should not set any agent env var; `std-env.isAgent` should be false.)

- [ ] **Step 4: Verify the script in the agent path**

Run:

```bash
CLAUDECODE=1 bun scripts/is-agent.ts
```

Expected output: `true`

If this prints `false`, the `std-env` version installed does not recognize `CLAUDECODE` as an agent marker. Check `std-env`'s docs for the current agent-detection env vars and use one of those instead; update the command above to match.

- [ ] **Step 5: Typecheck the new script**

Run:

```bash
pnpm typecheck
```

Expected: passes (the `scripts/` dir has its own tsconfig that already covers `*.ts`).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml scripts/is-agent.ts
git commit -m "feat(scripts): add is-agent.ts detection script"
```

---

## Task 4: Create Minimal `hk.pkl` with Guards Only

**Why "guards only" first:** Land the hk config with the lightest-weight hooks (branch protection, merge-conflict check, private-key check, large-file check) and verify it actually gets invoked on a commit before layering heavier checks on top. This catches any hk-install or Pkl-schema issues in isolation.

**Files:**

- Create: `hk.pkl`

- [ ] **Step 1: Write the initial Pkl config**

Create `hk.pkl` at the repo root with exactly this content:

```pkl
amends "package://github.com/jdx/hk/releases/download/v1.38.0/hk@1.38.0#/Config.pkl"
import "package://github.com/jdx/hk/releases/download/v1.38.0/hk@1.38.0#/Builtins.pkl"

// Workaround: hk util commands fail on Windows via cmd.exe, bash -c fixes it
local bash: String = "bash -c"

local guards = new Mapping<String, Step> {
    ["no-commit-to-branch"] {
        check = "hk util no-commit-to-branch --branch main"
        shell = bash
    }
    ["check-merge-conflict"] = (Builtins.check_merge_conflict) { shell = bash }
    ["detect-private-key"] = (Builtins.detect_private_key) { shell = bash }
    ["check-added-large-files"] = (Builtins.check_added_large_files) {
        shell = bash
        exclude = List("pnpm-lock.yaml")
    }
}

hooks {
    ["pre-commit"] {
        stash = "none"
        steps {
            ...guards
        }
    }
}
```

Note: the branch name is `main` (not `develop` as in the halcyon-derived reference). Do not leave `develop` in the config.

- [ ] **Step 2: Install hk hooks into `.git/hooks`**

Run:

```bash
hk install
```

Expected: hk writes shim scripts into `.git/hooks/` that delegate to `hk.pkl`. If `hk install` is not the current command name, check `hk --help` and use whatever command registers the git hooks.

- [ ] **Step 3: Verify the pre-commit hook fires on a trivial commit**

From a feature branch (NOT `main`), create a trivial change and commit:

```bash
git checkout -b verify/hk-smoke-test
echo "# smoke test" > /tmp/smoke.txt
cp /tmp/smoke.txt smoke.txt
git add smoke.txt
git commit -m "chore: smoke test hk guards"
```

Expected: all four guards run and pass; the commit succeeds. If hk does not fire at all, `hk install` did not register the hook correctly — diagnose before continuing. If any guard fails unexpectedly (e.g., `check-added-large-files` flags `smoke.txt`), inspect the output and fix the config.

- [ ] **Step 4: Verify branch protection blocks commits to `main`**

```bash
git checkout main
cp /tmp/smoke.txt smoke.txt
git add smoke.txt
git commit -m "chore: should be blocked"
```

Expected: the commit is **rejected** by the `no-commit-to-branch` guard. If it is not rejected, the branch-name argument or hk util behavior is wrong — fix before continuing.

Clean up:

```bash
git restore --staged smoke.txt
rm smoke.txt
git checkout verify/hk-smoke-test
rm smoke.txt 2>/dev/null || true
git reset --hard HEAD~1  # undo the smoke-test commit on the verify branch
git checkout -  # back to the working branch
git branch -D verify/hk-smoke-test
```

- [ ] **Step 5: Commit the hk.pkl file**

```bash
git add hk.pkl
git commit -m "feat(hooks): add hk.pkl with pre-commit guards"
```

---

## Task 5: Add Heavy Pre-Commit Steps (Agent-Conditioned)

**Files:**

- Modify: `hk.pkl` (add `isAgent` local, add heavy steps with condition)

- [ ] **Step 1: Extend `hk.pkl` with `isAgent` and heavy step definitions**

Edit `hk.pkl`. Between the `local bash` line and the `local guards` block, add:

```pkl
// Agent detection: evaluates to "true" when running inside an AI coding agent
local isAgent: String = #"exec("bun scripts/is-agent.ts") == "true""#
```

Then, after the `local guards` block and before the `hooks` block, add:

```pkl
// Base checker steps — reused by pre-commit (conditioned) and pre-push (unconditional)
local typecheck = new Step {
    glob = List("*.ts", "*.tsx")
    check = "pnpm typecheck:affected"
    shell = bash
    exclusive = true
}

local test = new Step {
    glob = List("*.ts", "*.tsx")
    check = "pnpm test:affected"
    shell = bash
    exclusive = true
}

local build = new Step {
    glob = List("*.ts", "*.tsx")
    check = "pnpm build:affected"
    shell = bash
    exclusive = true
}
```

Then update the `pre-commit` hook inside `hooks { ... }` to include the three conditioned steps:

```pkl
hooks {
    ["pre-commit"] {
        stash = "none"
        steps {
            ...guards
            ["typecheck"] = (typecheck) { condition = isAgent }
            ["test"] = (test) { condition = isAgent }
            ["build"] = (build) { condition = isAgent }
        }
    }
}
```

- [ ] **Step 2: Verify the human path (no agent env var) skips heavy steps**

From a feature branch, with a trivial TypeScript change, commit:

```bash
git checkout -b verify/hk-human-path
echo "export const x = 1;" >> packages/cli/src/cli.ts  # or any TS file
git add -A
git commit -m "chore: verify human pre-commit path"
```

Expected: guards run, ESLint/staged-file checks run, **typecheck/test/build do NOT run**. The commit completes in the same time as the guards-only hook from Task 4.

- [ ] **Step 3: Verify the agent path runs heavy steps**

Undo the previous commit without losing the change:

```bash
git reset --soft HEAD~1
```

Now commit with the agent env var set:

```bash
CLAUDECODE=1 git commit -m "chore: verify agent pre-commit path"
```

Expected: guards run, **AND** typecheck + test + build run (via `:affected`). The commit takes noticeably longer and exits 0 if the repo is in a passing state.

- [ ] **Step 4: Verify the agent path blocks on a failing change**

Introduce a deliberate typecheck failure:

```bash
git reset --soft HEAD~1
echo "export const broken: number = 'not a number';" >> packages/cli/src/cli.ts
git add -A
CLAUDECODE=1 git commit -m "chore: should fail typecheck"
```

Expected: the commit is **rejected** because `typecheck:affected` fails. Confirm the error message points to the typecheck failure.

Clean up:

```bash
git restore packages/cli/src/cli.ts
git branch -D verify/hk-human-path 2>/dev/null || true
git checkout -
```

- [ ] **Step 5: Commit**

```bash
git add hk.pkl
git commit -m "feat(hooks): gate typecheck/test/build on agent pre-commit"
```

---

## Task 6: Add Unconditional Pre-Push Heavy Steps

**Files:**

- Modify: `hk.pkl` (add `pre-push` hook block)

- [ ] **Step 1: Add the `pre-push` hook to `hk.pkl`**

Inside the `hooks { ... }` block, after the `pre-commit` entry, add:

```pkl
    ["pre-push"] {
        steps {
            ["typecheck"] = typecheck
            ["test"] = test
            ["build"] = build
        }
    }
```

(The steps reuse the `typecheck` / `test` / `build` locals defined in Task 5. No `condition` is set — every push triggers them.)

- [ ] **Step 2: Verify pre-push runs on `git push`**

From a feature branch with no remote, set an upstream to trigger the hook locally without actually pushing to a shared remote. Easiest approach: create a dummy local bare repo.

```bash
git checkout -b verify/hk-push-test
mkdir -p /tmp/bedrock-hk-verify.git
git -C /tmp/bedrock-hk-verify.git init --bare
git remote add verify-local /tmp/bedrock-hk-verify.git
git push -u verify-local verify/hk-push-test
```

Expected: the push invokes hk's `pre-push` hook, runs typecheck + test + build, and (if all pass) completes the push.

- [ ] **Step 3: Verify pre-push blocks on a failing change**

Introduce a deliberate failure, commit (human-path, so pre-commit does NOT catch it), then try to push:

```bash
echo "export const broken2: number = 'still not a number';" >> packages/cli/src/cli.ts
git add -A
git commit -m "chore: should fail on push"
git push verify-local verify/hk-push-test
```

Expected: the push is **rejected** because `typecheck` fails in pre-push.

Clean up:

```bash
git restore packages/cli/src/cli.ts 2>/dev/null || true
git reset --hard HEAD~1 2>/dev/null || true
git remote remove verify-local
rm -rf /tmp/bedrock-hk-verify.git
git checkout -
git branch -D verify/hk-push-test
```

- [ ] **Step 4: Commit**

```bash
git add hk.pkl
git commit -m "feat(hooks): add unconditional pre-push gate"
```

---

## Task 7: Add Post-Merge Auto-Install Hooks

**Files:**

- Modify: `hk.pkl` (add `post-merge` hook)

- [ ] **Step 1: Add the `post-merge` block inside `hooks`**

After the `pre-push` entry, add:

```pkl
    ["post-merge"] {
        steps {
            ["install-deps"] {
                glob = List("pnpm-lock.yaml")
                check = "pnpm install"
                shell = bash
            }
            ["mise-install"] {
                glob = List("mise.toml")
                check = "mise install"
                shell = bash
            }
        }
    }
```

- [ ] **Step 2: Verify the post-merge hook activates when the lock file changes**

Simulate a merge that touches `pnpm-lock.yaml`:

```bash
git checkout -b verify/hk-post-merge
git checkout main -- pnpm-lock.yaml  # no-op if lock is unchanged; use a real diff if possible
touch pnpm-lock.yaml
git add pnpm-lock.yaml
git commit -m "chore: touch lockfile"
git checkout -
git merge verify/hk-post-merge --no-edit
```

Expected: after the merge, `pnpm install` runs automatically. If the lockfile did not actually change content, the glob may not match — that is fine (the hook's job is to run only when relevant files change).

Clean up:

```bash
git reset --hard HEAD~1
git branch -D verify/hk-post-merge
```

- [ ] **Step 3: Commit**

```bash
git add hk.pkl
git commit -m "feat(hooks): auto-install deps on post-merge"
```

---

## Task 8: Add commitlint and `commit-msg` Hook

**Files:**

- Modify: `package.json` (add `@commitlint/cli`, `@commitlint/config-conventional`)
- Modify: `pnpm-workspace.yaml` (add to catalogs if consistent with existing pattern)
- Create: `commitlint.config.ts`
- Modify: `hk.pkl` (add `commit-msg` hook)

- [ ] **Step 1: Install commitlint**

```bash
pnpm add -D -w @commitlint/cli @commitlint/config-conventional
```

Expected: both packages added to root `devDependencies`. If pnpm catalogs are used, mirror the addition there.

- [ ] **Step 2: Create `commitlint.config.ts`**

At the repo root, create `commitlint.config.ts` with:

```ts
import type { UserConfig } from "@commitlint/types";

const config: UserConfig = {
	extends: ["@commitlint/config-conventional"],
};

export default config;
```

No project-specific rules are added in this task. The existing repo already uses Conventional Commits by convention; the config just enforces the default ruleset.

- [ ] **Step 3: Verify commitlint parses a valid message**

Run:

```bash
echo "docs: example message" | pnpm commitlint
```

Expected: exit 0, no output.

- [ ] **Step 4: Verify commitlint rejects a malformed message**

```bash
echo "not a conventional commit" | pnpm commitlint
```

Expected: exit 1, error output indicating the subject does not match the conventional format.

- [ ] **Step 5: Add the `commit-msg` hook to `hk.pkl`**

Inside the `hooks { ... }` block, add:

```pkl
    ["commit-msg"] {
        steps {
            ["commitlint"] {
                check = "pnpm commitlint --edit {{commit_msg_file}}"
                shell = bash
            }
        }
    }
```

- [ ] **Step 6: Verify the hook fires on a bad commit message**

On a feature branch, make a trivial change and try to commit with a bad message:

```bash
git checkout -b verify/hk-commitlint
echo "x" >> smoke.txt
git add smoke.txt
git commit -m "not conventional"
```

Expected: the commit is **rejected** by the `commit-msg` hook.

Then retry with a valid message:

```bash
git commit -m "chore: verify commitlint hook"
```

Expected: the commit succeeds.

Clean up:

```bash
git reset --hard HEAD~1
rm smoke.txt
git checkout -
git branch -D verify/hk-commitlint
```

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml commitlint.config.ts hk.pkl
git commit -m "feat(hooks): enforce conventional commits via commitlint"
```

---

## Task 9: Remove `simple-git-hooks` and `lint-staged`

**Why now (not earlier):** Keeping simple-git-hooks alive until hk is fully validated means there is always a working hook manager during migration. Only remove the old tool once the new one is proven across all hook types.

**Files:**

- Modify: `package.json` (remove devDeps and config fields)
- Modify: `pnpm-workspace.yaml` (remove catalog entries if present)

- [ ] **Step 1: Uninstall the old packages**

```bash
pnpm remove -D -w simple-git-hooks lint-staged
```

Expected: both packages removed from root `devDependencies`. If either has a catalog entry in `pnpm-workspace.yaml`, remove it.

- [ ] **Step 2: Remove the config fields from `package.json`**

Open `package.json` and delete these two top-level fields entirely:

```json
{
	"simple-git-hooks": {
		"pre-commit": "pnpm i --frozen-lockfile --ignore-scripts --offline && npx lint-staged"
	},
	"lint-staged": {
		"*": "eslint --fix --cache"
	}
}
```

After removal, `package.json` should not contain either key.

Note: the `pnpm i --frozen-lockfile --ignore-scripts --offline` preamble from the old hook is intentionally dropped. mise handles tool versioning; hk + mise do not need a pre-hook install step. If any workflow depended on that preamble (it should not — it was a hook-only artifact), diagnose before removing.

- [ ] **Step 3: Re-run `hk install` to confirm hooks still wired**

```bash
hk install
```

Expected: hk re-registers its shims in `.git/hooks/`. (Uninstalling `simple-git-hooks` may have removed its own shim, but hk's shim should be intact.)

- [ ] **Step 4: Smoke test a commit**

From a feature branch, make a trivial change and commit:

```bash
git checkout -b verify/hk-post-removal
echo "x" >> smoke.txt
git add smoke.txt
git commit -m "chore: verify hk after sgh removal"
```

Expected: guards run, commit succeeds. If hk does not fire, re-install and diagnose.

Clean up:

```bash
git reset --hard HEAD~1
rm smoke.txt
git checkout -
git branch -D verify/hk-post-removal
```

- [ ] **Step 5: Move ESLint onto an unconditional hk pre-commit step**

The old `lint-staged` config ran `eslint --fix --cache` on staged files. That behavior needs to move into `hk.pkl` so human commits still get linted. Edit `hk.pkl` and add an `eslint` entry inside the `pre-commit` steps block, after `...guards` and before the conditioned heavy steps:

```pkl
            ["eslint"] = new Step {
                glob = List("*.ts", "*.tsx", "*.js", "*.jsx")
                check = "eslint --fix --cache"
                shell = bash
            }
```

Note: this step runs unconditionally (no `condition = isAgent`), matching the previous `lint-staged` behavior. It runs in parallel with the guards because no `exclusive = true` is set and guards are not exclusive either.

- [ ] **Step 6: Verify the ESLint step fires on a TS file change**

```bash
git checkout -b verify/hk-eslint
echo "export const unused = 1" >> packages/cli/src/cli.ts  # likely triggers an unused-var lint rule
git add -A
git commit -m "chore: verify eslint step"
```

Expected: ESLint runs. Depending on the project's ESLint config, it may auto-fix or reject. Adjust the test line if needed to trigger a real warning.

Clean up:

```bash
git restore packages/cli/src/cli.ts 2>/dev/null || true
git reset --hard HEAD 2>/dev/null || true
git checkout -
git branch -D verify/hk-eslint 2>/dev/null || true
```

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml hk.pkl
git commit -m "build: remove simple-git-hooks and lint-staged in favor of hk"
```

---

## Task 10: Update CI to Use `hk check`

**Why:** The CI workflow currently runs `lint → typecheck → build → test` as four separate steps. Consolidating via `hk check` means "what CI runs" is defined in one place (`hk.pkl`), aligning local enforcement with CI enforcement. The `check` hook runs everything unconditionally — appropriate for CI.

**Files:**

- Modify: `hk.pkl` (add the `check` hook)
- Modify: `.github/workflows/ci.yaml`

- [ ] **Step 1: Add the `check` hook to `hk.pkl`**

Inside the `hooks { ... }` block, add:

```pkl
    ["check"] {
        steps {
            ...guards
            ["eslint"] = new Step {
                glob = List("*.ts", "*.tsx", "*.js", "*.jsx")
                check = "eslint --cache"
                shell = bash
            }
            ["typecheck"] = typecheck
            ["test"] = test
            ["build"] = build
        }
    }
```

Notes:

- ESLint in the `check` hook uses `eslint --cache` without `--fix` (CI should not auto-fix).
- All heavy steps run unconditionally — the `check` hook is the manual / CI entry point, so no `condition` is applied.
- `typecheck`, `test`, and `build` here reference the same locals defined in Task 5 and still use the `:affected` scripts. For CI we may want the full runs, not affected — see Step 2.

- [ ] **Step 2: Decide on `:affected` vs. full runs in CI**

CI's existing behavior runs the full suite via `pnpm lint:ci`, `pnpm turbo typecheck`, `pnpm turbo build`, `pnpm test:ci`. Those are unconditional full runs. The `hk check` hook as written above uses `:affected` (the locals are shared with pre-commit / pre-push). This is a deliberate behavior change: CI will only run tasks for packages whose files changed vs. the base ref.

If this change is acceptable, leave the config as-is. If CI should continue running the full suite:

1. Define separate `typecheckFull` / `testFull` / `buildFull` locals in `hk.pkl` (copies of the existing locals but with `pnpm typecheck` / `pnpm test` / `pnpm build` as the check commands).
2. Use those in the `check` hook instead.

Recommendation: go with `:affected` in CI to match the stated intent of the ADR. Full runs remain available manually via `pnpm typecheck` / `pnpm test` / `pnpm build`.

- [ ] **Step 3: Update `.github/workflows/ci.yaml`**

Replace the four individual quality-gate steps with a single `hk check` invocation. The existing CI file has these steps (lines 41–54 approximately):

```yaml
- name: Lint
  run: pnpm lint:ci

- name: Typecheck
  run: pnpm turbo typecheck

- name: Build
  run: pnpm turbo build

- name: Generate example tests
  run: pnpm gen:example-tests

- name: Test
  run: pnpm test:ci
```

Replace those five steps with:

```yaml
- name: Generate example tests
  run: pnpm gen:example-tests

- name: Run hk check
  run: hk check
```

Keep the `Generate example tests` step (it is a code-generation step, not a quality gate, and must run before tests). Place it before `hk check` so generated tests are visible to the test step.

- [ ] **Step 4: Verify hk is available in CI**

The `./.github/actions/setup` composite action is responsible for installing mise-managed tools. Confirm it already runs `mise install` or equivalent; if so, adding `hk` to `mise.toml` in Task 2 means CI picks it up automatically. If the setup action does NOT install mise tools, fix it as part of this task — read `.github/actions/setup/action.yaml`, verify, and add a `mise install` step if missing.

- [ ] **Step 5: Commit**

```bash
git add hk.pkl .github/workflows/ci.yaml
git commit -m "ci: replace individual gates with hk check"
```

- [ ] **Step 6: Push and verify CI runs the new pipeline**

```bash
git push
```

Watch the CI run via `gh run watch` or in the GitHub Actions UI. Expected: CI completes using `hk check` as the sole quality-gate invocation. If CI fails because `hk` is not on PATH, revisit Step 4.

---

## Task 11: Final Smoke Test and Open PR

ADR-013 was flipped to Accepted before implementation began; no ADR edits are needed here. This task is a full end-to-end verification of every hook the plan has added, followed by the PR.

- [ ] **Step 1: Final smoke test of the complete hook surface**

From a feature branch, run an end-to-end scenario that exercises every hook:

```bash
git checkout -b verify/hk-final-smoke
echo "export const smoke = 1" >> packages/cli/src/cli.ts
git add -A
git commit -m "chore: final hk smoke test"  # commit-msg → commitlint, pre-commit → guards + eslint (human path)
CLAUDECODE=1 git commit --amend --no-edit  # re-runs pre-commit, this time with heavy steps
git push verify-local verify/hk-final-smoke 2>/dev/null || true  # pre-push fires; OK if no verify-local remote
```

Expected: commit-msg passes, pre-commit passes on both human and agent paths, pre-push fires (or is skipped if no remote is configured — that is fine).

Clean up:

```bash
git restore packages/cli/src/cli.ts
git reset --hard HEAD~1
git checkout -
git branch -D verify/hk-final-smoke
```

- [ ] **Step 2: Run the CLAUDE.md "Before Committing" checklist against the final state**

```bash
pnpm lint
pnpm build
pnpm test
pnpm typecheck
```

Expected: all four pass. This is redundant with the hk-enforced gate but is the project-wide acceptance test per CLAUDE.md.

- [ ] **Step 3: Push the branch and open a pull request**

```bash
git push -u origin $(git branch --show-current)
gh pr create --title "feat(hooks): adopt hk with AI-vs-human differentiated gating (ADR-013)" --body "$(cat <<'EOF'
## Summary

- Replaces `simple-git-hooks` + `lint-staged` with **hk** (via mise)
- Wires differentiated pre-commit gating: heavy checks (typecheck + test + build) run at commit time for AI-generated commits and at push time for humans
- Enforces Conventional Commits via `commitlint` on `commit-msg`
- Consolidates CI quality gates behind `hk check`

Implements ADR-013.

## Test plan

- [ ] `pnpm lint` passes
- [ ] `pnpm build` passes
- [ ] `pnpm test` passes
- [ ] `pnpm typecheck` passes
- [ ] Pre-commit guards fire on a human commit
- [ ] Pre-commit heavy gate fires on `CLAUDECODE=1 git commit`
- [ ] Pre-push gate fires on `git push`
- [ ] commitlint rejects a malformed commit message
- [ ] CI passes with `hk check` as the sole quality gate
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** Every section of the ADR Decision block has a corresponding task: guards (Task 4), heavy pre-commit (Task 5), pre-push (Task 6), post-merge (Task 7), commit-msg / commitlint (Task 8), global config (`stash`, `bash -c`) (Task 4), dependency changes (Tasks 2, 3, 8, 9), CI (Task 10), final smoke test + PR (Task 11). The `prepare-commit-msg` hook is deliberately out of scope, documented in File Structure.
- **Verification at every task boundary:** every task ends with a concrete verification step AND a commit, so regressions are caught early and history shows the incremental progress.
- **Naming consistency:** The Pkl locals `typecheck`, `test`, `build` are defined in Task 5 and reused in Tasks 6 and 10 without renaming. The `isAgent` local is defined once in Task 5. The `guards` Mapping is defined in Task 4 and spread into multiple hooks via `...guards` without duplication.
- **TDD note:** This is infrastructure/config work, not feature code. The "tests" are end-to-end verifications (make a commit, observe hook behavior) rather than unit tests. Each task still follows the red-green pattern: a verification step that would fail before the task's changes are applied, then the changes, then the verification passing.
