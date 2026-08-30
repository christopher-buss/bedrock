# ADR-029: pnpm Native Versioning in Place of the Changesets CLI

**Date:** 2026-08-04 **Status:** Accepted

Decision Makers: Maintainer  
Tags: developer-workflow, tooling, release, publishing, versioning, pnpm

Supersedes [ADR-027](./027-changesets-release-flow.md).

## Context

ADR-027 adopted Changesets as the source of truth for versions and changelogs,
wrapped in a bespoke `release.yaml` that satisfies this repo's two hard CI
constraints (`required_signatures` on every ref, and `GITHUB_TOKEN` pushes not
triggering workflows). That flow works and has shipped several releases.

pnpm 11.13.0 then added native workspace release management, and this repo
already pins pnpm 11.20.0 in `packageManager`. The relevant property is that it
is not a competing format: intent files are the **same `.changeset/*.md`
markdown-with-frontmatter files**, in the same directory, so the tooling can be
swapped without rewriting the pending intents or the committed changelogs.

The question this ADR answers is whether to keep two dev dependencies and a
dedicated catalog for a job the pinned package manager now does natively.

The nature of the change is unchanged from ADR-027 — a release tool and a
mandatory developer policy — so it is ADR-gated on the same two counts under
ADR-006.

Two capability gaps drove the analysis, and both are real:

1. **No pluggable changelog generator.** pnpm has no equivalent of
   `@changesets/changelog-github`. The `versioning.changelog` settings expose
   only `storage`. (`VersioningChangelogSettings` carries an undocumented
   `format?: string` that the validator accepts and nothing consumes — treat it
   as inert.)
2. **No `changeset status --since`.** `pnpm change status` reports the pending
   intents and the plan they produce. It has no `--since`, no `--json`, and
   exits 0 unconditionally, so it cannot answer "this branch touched a published
   package and recorded no intent". A `pnpm change check` was specified in RFC
   0006 but did not ship.

A third gap — no `linked` groups, only `fixed` — forces a deliberate behaviour
change and is treated as its own section below.

Everything else ADR-027 relies on carries over unchanged: every internal edge
already uses `workspace:*` (which pnpm requires and hard-fails without), both
published packages already carry `publishConfig.access: public`, and no snapshot
or prerelease flow is in use.

## Decision

Replace `@changesets/cli` and `@changesets/changelog-github` with pnpm's
built-in `pnpm change` / `pnpm version -r` / `pnpm publish -r`. Keep ADR-027's
release _topology_ — signed bot commit, human-gated `ci: version packages` PR,
OIDC trusted publishing, tag-triggered docs deploy — and swap only the tool that
implements each step.

### Configuration moves to `pnpm-workspace.yaml`

`.changeset/config.json` is deleted; pnpm reads none of it. Config lives under a
`versioning` key:

| Changesets config                         | pnpm equivalent                             |
| ----------------------------------------- | ------------------------------------------- |
| `linked: [[core, ocale]]`                 | `versioning.fixed: [[core, ocale]]`         |
| `privatePackages: { version: false }`     | `versioning.ignore: [...]` (explicit list)  |
| `access: public`                          | `publishConfig.access` (already set)        |
| `updateInternalDependencies: patch`       | automatic, and range-accurate               |
| `baseBranch: main`                        | not configurable; hardcoded `main`/`master` |
| `changelog: @changesets/changelog-github` | none — `changelog.storage: repository`      |
| —                                         | `versioning.maxBump: minor` (new)           |

Three of these need explaining:

- **`changelog.storage: repository` must be set explicitly.** The default is
  `registry`, which commits no `CHANGELOG.md` and instead parks composed
  sections in `.changeset/changelogs/` until the registry confirms publication.
  That would change our published artifacts and break the docs site's changelog
  pages. `repository` keeps today's committed-changelog behaviour, and has the
  secondary benefit that intent cleanup no longer depends on a registry
  round-trip.
- **`ignore` must list the private packages.** pnpm only auto-excludes private
  packages with **no `version` field**; all six of ours carry one. Without the
  list, `apps/e2e` appears in the release plan for depending on `core`/`ocale`.
  This is the one place pnpm needs _more_ configuration than Changesets did.
- **`maxBump: minor` is new.** CLAUDE.md's pre-1.0 rule ("never write `major`;
  `major` on 0.x jumps straight to 1.0.0") was documentation only. `maxBump` is
  enforced on the assembled plan, after propagation and fixed-group resolution,
  so it also catches a `major` that arrives through a dependency. It must be
  removed deliberately for the 1.0.0 release.

### Fixed, not linked — an accepted regression

pnpm implements `fixed` groups only. RFC 0006 states `linked` was deliberately
left out of v1 as "rarely used" with "jump-to-highest semantics [that]
surprise". The shipped validator has no `linked` case at all, so a stray
`versioning.linked` key would be silently ignored rather than rejected.

ADR-027 chose `linked` precisely to avoid `fixed`'s no-op releases. That trade
is no longer on the table, and of the two remaining options `fixed` is the one
that preserves ADR-027's actual goal — a single shared version number for a
matched pair:

- **`fixed`** publishes an otherwise-untouched `ocale` when only `core` changed.
  The cost is one no-op release with an empty changelog section, on the less
  common direction of change: `core` depends on `ocale`, so `ocale` changes
  already cascade into `core` today.
- **No group** lets the versions diverge (`core@0.1.4` + `ocale@0.1.3`), which
  is the outcome ADR-027 set out to prevent and which ADR-027 rejected under
  "independent".

This is a genuine regression against ADR-027's Decision, accepted knowingly.

### Changelog entries lose their PR, commit, and author links

`@changesets/changelog-github` rendered each entry as a bullet carrying a PR
link, a commit link, and a `Thanks [@author]!` attribution. pnpm renders the
intent summary as plain markdown.

The surrounding structure is byte-compatible — `# <pkg>` title, `## <version>`,
`### Major|Minor|Patch Changes` — so existing `CHANGELOG.md` files append
cleanly and nothing has to be rewritten. Dependency cascades render as a
`- Updated dependencies:` bullet without commit hashes.

For a solo-maintained repo the author attribution is noise; the PR backlink is
the real loss, and it remains recoverable from `git log` and the release tag.
Post-processing the generated changelog to re-add links was rejected as bespoke,
untested code standing between the release job and npm.

### The blocking gate becomes inline bash

ADR-027's mandatory-intent policy is unchanged; only its implementation moves.
`changeset-check.yaml` now derives the touched packages from
`pnpm list -r --depth -1 --json --filter "[origin/<base>]"` and asserts that
every published package in that set is named by a frontmatter line in an intent
**the PR itself adds or modifies**.

Both halves of that last clause matter, and neither is free —
`changeset status --since` enforced them implicitly:

- **PR-scoped, not repo-wide.** Intents accumulate on `main` until a Version PR
  consumes them, so at any time `main` may already carry an intent naming
  `core`. Scanning every `.changeset/*.md` would let a later `core` change pass
  on the strength of an unrelated pending intent and ship with no changelog
  entry of its own. The candidate set is therefore
  `git diff --name-only --diff-filter=AM "origin/<base>" HEAD -- .changeset`,
  minus `README.md`.
- **Frontmatter, not the whole file.** `pnpm version -r` builds its plan from
  the frontmatter alone, so a body line reading `@bedrock-rbx/core: ...` would
  satisfy a whole-file `grep` while producing no version bump and no changelog
  entry. The scan stops at the closing `---`.

Both comparisons are two-dot, matching how `pnpm list --filter "[<ref>]"`
compares, so the two halves of the gate cannot disagree about what the PR
changed. On a `pull_request` run `HEAD` is the merge commit, which already
contains the base, so the two-dot and three-dot forms agree anyway.

The `...` dependents prefix is deliberately **omitted** from the filter: an
ocale-only change marks `core` as changed through the `workspace:*` edge, and
that cascade is applied automatically by `pnpm version -r`. Demanding an intent
for it would be a false failure.

`pnpm change --bump none <pkg>` replaces `pnpm changeset add --empty` as the
escape hatch, and is a better fit for this gate: it names the declined package
explicitly instead of recording an anonymous empty changeset.

### Publishing: `pnpm publish -r`, and tags we create ourselves

`pnpm version -r` never commits and never tags — a recursive run can bump
packages to different versions, so there is no single version to tag. Both were
already explicit steps in `release.yaml` for the commit; the tag now becomes
explicit too, because `changeset publish` used to create them and `pnpm publish`
does not.

`release.yaml` therefore derives `<name>@<version>` tags from the **public
workspace manifests** (`pnpm list -r --depth -1 --json`, minus the private
packages), creates the ones that do not already exist, and pushes them. This
also retires the `"New tag:"` stdout grep that detected whether anything
published: a newly created `@bedrock-rbx/core@*` tag is now the signal that
gates the docs dispatch. `website-release.yaml`'s trigger and ADR-004 are
untouched.

`pnpm publish -r` skips versions already on the registry, so a rerun after a
partial failure resumes rather than double-publishing — the same property
`changeset publish` provided. OIDC trusted publishing is unchanged: the same
`pnpm publish` is what exchanged the token before, one layer down.

That resume property is exactly why the tags come from the manifests and not
from `--report-summary`. The summary lists only what **this invocation** put on
the registry. If `pnpm publish -r` gets `ocale` out and then fails on `core`,
the job fails before tagging; the retry publishes `core` alone, and a
summary-derived tag step would tag `core` and never tag `ocale`. Reading the
manifests instead makes the step converge: a `pnpm publish -r` that exits 0
leaves every public package's current version on the registry regardless of
which run put it there, so tagging every public manifest version — skipping
those already tagged — is correct after a clean run and self-healing after a
partial one. The same idempotence makes the step a harmless no-op on a push to
`main` that releases nothing.

### Not adopted: `pnpm/release`

`pnpm/release` is the `changesets/action` counterpart, and its README states the
parallel directly. It is **not usable**: `main` is empty, the action lives on an
open PR branch, and there are no tags — `pnpm/release@v0` does not resolve.

This costs nothing here. ADR-027 already rejected `changesets/action` because
its unsigned `GITHUB_TOKEN` push is refused by `required_signatures`, and
`pnpm/release` pushes the same way. The bespoke workflow was required either
way.

## Consequences

### Positive

- **Two dev dependencies and the `release` catalog are gone**, along with an
  upstream to track. ADR-027 listed the deps as a known cost.
- **The release tool is the pinned package manager**, so it cannot drift out of
  step with the workspace features it has to understand (catalogs,
  `workspace:*`, patched dependencies).
- **The pre-1.0 bump policy is now enforced** by `maxBump: minor` rather than
  documented in CLAUDE.md and CONTRIBUTING.md.
- **Dependency propagation is range-accurate.** pnpm computes the range the
  dependent's modifier produced at its previous release and republishes when the
  new version falls outside it, rather than applying a fixed
  `updateInternalDependencies` bump class.
- **`.changeset/ledger.yaml` records which intents each released version
  consumed**, which makes cherry-picks and merge-backs between release branches
  safe. Not needed today; free insurance if a maintenance branch ever appears.

### Negative

- **Changelog entries lose PR, commit, and author links** (see Decision). Not
  recoverable without bespoke post-processing.
- **`ocale` gets no-op releases** when only `core` changes, because `fixed`
  replaces `linked` (see Decision).
- **The blocking gate is hand-written**, so it is ours to maintain and it
  hardcodes the two published package names. It replaces a supported upstream
  flag with shell, and a future third published package must be added to the
  loop. `pnpm change check` may make it deletable later.
- **The private-package list is manual.** ADR-027 needed no `ignore` entries;
  this needs six, and a new private package must be added or it enters the
  release plan.
- **`versioning` has no schema published for editor validation**, unlike
  `.changeset/config.json`'s `$schema` line. A typo'd key is silent — notably
  `versioning.linked`, which the validator does not reject.

### Neutral

- **The release topology is unchanged.** Signed ghcommit, `ci: version packages`
  PR, human-gated merge, OIDC publish, tag-dispatched docs build: all identical.
  The blast radius is the tool, not the pipeline.
- **`.changeset/` keeps its name** even though the Changesets CLI is gone. pnpm
  uses that directory by design; renaming is not an option, and the format there
  genuinely is the changesets format.
- **The `changeset-release/main` branch name and the `Changeset Check` workflow
  name are kept.** Both are load-bearing for branch protection and for the
  head-ref guards in `lint-pr-title.yaml` and `smoke.yaml`; renaming them buys
  tidiness at the cost of churn across four workflows.
- **`pnpm update --changeset` stops working.** It is the one feature still
  reading `.changeset/config.json`, degrading to a warning once that file is
  gone. Nothing in this repo uses it.

## Alternatives Considered

### Stay on Changesets

**Rejected, narrowly.** The status quo works, and it keeps GitHub-linked
changelogs and a supported `status --since`. What tips it is that both costs are
small (a solo repo does not need author attribution; the gate is fifteen lines)
while the benefit compounds: the release tool stops being a second thing that
has to understand pnpm catalogs and `workspace:*`. Had `linked` been the only
sticking point, or had the changelog links been consumer-facing on a
multi-contributor project, staying would be the right call.

### pnpm versioning with no fixed group

**Rejected.** Letting `core` and `ocale` diverge avoids the no-op releases but
discards the shared version number, which is the property ADR-027 was protecting
and which it rejected explicitly under "independent". Trading a cosmetic cost
for a semantic one is the wrong direction.

### Post-process the changelog to re-add PR links

**Rejected.** It would restore the links, but as untested shell or script code
running inside the release job, between version bump and publish, on a path with
no local test coverage. The links are recoverable from `git log`; the failure
mode is a broken release.

### Keep `.changeset/config.json` as a stub

**Rejected.** The only thing that would preserve is `pnpm update --changeset`,
which this repo does not use. A config file that no tool reads except one unused
command is a trap for the next reader.

## Implementation Notes

**Files modified:**

- `pnpm-workspace.yaml` — add the `versioning` block; delete the `release`
  catalog (`cleanupUnusedCatalogs: true` flags it otherwise).
- `package.json` (root) — drop both `@changesets/*` devDependencies; drop the
  `changeset` script; `release` becomes `pnpm build && pnpm publish -r`. The
  `version` script is **deleted rather than ported**: `version` is an npm
  lifecycle name, and pointing it at `pnpm version -r` risks re-entrant
  execution under `enablePrePostScripts: true`. CI calls the command directly.
- `.changeset/config.json` — deleted.
- `.changeset/README.md` — rewritten for the pnpm commands.
- `.github/workflows/changeset-check.yaml` — the gate per Decision.
- `.github/workflows/release.yaml` — `pnpm version -r --no-git-checks`;
  `pnpm publish -r --no-git-checks`; new tag-creation step. `--no-git-checks` is
  required on both: `pnpm version -r` refuses a dirty tree, and `pnpm publish`
  defaults its expected branch to `master`.
- `CONTRIBUTING.md`, `CLAUDE.md`, `docs/adr/004-documentation-site.md` — command
  and terminology updates.

**Unchanged:** `hk.pkl`, `ci.yaml`, `commitlint.config.ts`, `knip.ts`,
`release-actions.yaml`, `website-release.yaml`, and both `CHANGELOG.md` files.
knip's Changesets plugin de-activates with `.changeset/config.json`, in the same
change that removes the dependencies it accounted for.

**New committed artifact:** `.changeset/ledger.yaml`, written by
`pnpm version -r`. It is covered by the existing ghcommit `file_pattern`
(`.changeset packages pnpm-lock.yaml`). No `.changeset/changelogs/` directory
appears under `storage: repository`.

**External prerequisites:** unchanged from ADR-027 — the npmjs.com Trusted
Publisher per package, and "Allow GitHub Actions to create and approve pull
requests".

**Verification:** `pnpm change status` and `pnpm version -r --dry-run` produce
the expected plan with both packages at one version; a real
`pnpm version -r --no-git-checks` on a scratch branch produces equal versions in
both manifests, prepends both changelogs, writes `ledger.yaml`, consumes the
intents, and creates no `.changeset/changelogs/`; the gate fails a PR whose
published-package change carries no intent.

## Related Decisions

- **ADR-027**: Changesets Release Flow — superseded by this ADR. Its Context
  (the three defects that motivated automated releases) and its analysis of the
  signing and workflow-trigger constraints remain the reason `release.yaml` is
  shaped the way it is.
- **ADR-006**: ADR Enforcement — gated on the same two counts as ADR-027: a
  release tool choice, and a mandatory developer policy.
- **ADR-004**: Documentation Site — the `@bedrock-rbx/core@*` tag trigger is
  preserved, but the tags are now created by `release.yaml` rather than by
  `changeset publish`.
- **ADR-013**: hk — the intent gate stays a CI check, not a local hook tier.
- **ADR-014**: Vite+ — release orchestration remains outside `vp`, as with
  `knip` (ADR-016) and `mutate:changed` (ADR-015).
- **ADR-016**: Knip — the Changesets plugin and the dependencies it accounted
  for are removed together.

## Amendment: 2026-08-21, first-party plugins join the fixed group

ADR-030 introduces plugin packages that extend core through its public
contracts, the first being `@bedrock-rbx/state-s3`.

The `fixed` group under `versioning` grows to include first-party plugin
packages alongside `@bedrock-rbx/core` and `@bedrock-rbx/ocale`. A plugin
implements contracts core owns, so the compatible pairing is the one released
together, and the `workspace:*` edge already required expresses that exactly,
with no range to reason about and no compatibility matrix to maintain.

The cost is that a first-party plugin releases whenever core does, including
when nothing in the plugin changed.

Third-party plugins have no access to this mechanism and express compatibility
as a peer range on `@bedrock-rbx/core` instead. The two paths differ, and a
third-party author does not inherit the first-party guarantee.

## Amendment: 2026-08-30, the action is versioned but not published

`@bedrock-rbx/actions` is consumed as a git ref, not from a registry: a workflow
pins `christopher-buss/bedrock/packages/actions/deploy@actions-v<x.y.z>`. That
tag is a release, and it was cut by hand, with the version typed rather than
derived from anything.

The action leaves `versioning.ignore` while staying `"private": true`. pnpm
filters on `private` before any tarball work, so it never reaches npm, but it
now carries a version, a `CHANGELOG.md`, and a ledger entry, and `pnpm change`
accepts intents against it. It is not in the `fixed` group and depends on no
released package, so it enters a release plan only when an intent names it.
`release.yaml` cuts `actions-v<x.y.z>` from that version and dispatches
`release-actions.yaml` to bake the bundled dist onto the tag.

The manifest carried `0.0.0` while the newest shipped tag was `actions-v0.1.1`,
so joining the release plan needs a one-time seed of the manifest to `0.1.1`.
Left at `0.0.0`, the first plan would cut a tag behind the one consumers already
pin. That seed is the last hand-written version this package takes; every bump
after it comes from `pnpm version -r`.

Two Consequences above are narrowed by this:

- **`ignore` must list the private packages** now reads: it must list the
  private packages that should not be versioned. Membership tracks whether a
  package has a version line of its own, which is not the same question as
  whether it publishes.
- **The blocking gate hardcodes the two published package names** no longer
  holds. It derives the public half from the workspace manifests, so a newly
  published package is gated the day it lands; `@bedrock-rbx/state-s3` shipped
  before that change and was ungated in the interval. One name is still written
  out, `@bedrock-rbx/actions`, because "versioned" and "public" have stopped
  being the same set and only the public half is derivable from the manifests.

The cost is that private no longer implies unversioned, so a private package's
`ignore` membership has to be a decision rather than a default.

## References

- [pnpm release management](https://pnpm.io/versioning)
- [`pnpm change`](https://pnpm.io/cli/change) ·
  [`pnpm version`](https://pnpm.io/cli/version) ·
  [`pnpm publish`](https://pnpm.io/cli/publish)
- [`versioning` settings reference](https://pnpm.io/settings/versioning)
- [RFC 0006 — Native monorepo versioning](https://github.com/pnpm/rfcs/blob/main/text/0006-monorepo-versioning.md)
- [`pnpm/release`](https://github.com/pnpm/release) — the unreleased
  `changesets/action` counterpart.
