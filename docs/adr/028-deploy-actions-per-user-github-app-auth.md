# ADR-028: Deploy Actions and Per-User GitHub App Auth for Codegen Commit-Back

**Date:** 2026-06-23  **Status:** Accepted

Decision Makers: Maintainer
Tags: actions, auth, github-app, codegen, ci, boundary

## Context

A Bedrock deploy that runs codegen rewrites the project's generated asset-id
files (`codegen.output`). In CI those regenerated files must be committed back
to the deploy branch — typically a protected `main` — so the next normal build
references the new ids. This "commit-back" pattern is common enough that
shipping it from Bedrock removes a chunk of bespoke CI glue every consumer would
otherwise hand-write (fetch the tip, reapply the generated files, commit, push
with a race retry, all under a token allowed to bypass branch protection).

Three forces shape how it is shipped:

1. **The push needs an identity that can write a protected branch.** The
   workflow's built-in `GITHUB_TOKEN` is blocked by "require a pull request" /
   "restrict who can push" rules. The only attributable identity addable to a
   branch-protection bypass list (short-lived, repo-scoped, not tied to a person
   who can leave) is a **GitHub App** installation token.
2. **Bedrock is a zero-service tool.** State lives in GitHub Gists precisely to
   avoid running infrastructure. A shared, hosted "Bedrock bot" App would
   reintroduce exactly that — and is impossible to do safely anyway: a GitHub
   App authenticates with a **private key**, and minting `contents:write` tokens
   across every consumer's repository would mean distributing that key. A shared
   App holding write tokens across orgs is also a severe trust boundary.
3. **Commit-back is pure git plumbing, not Open Cloud.** Fetching, committing,
   and pushing to a branch is orthogonal to `@bedrock-rbx/core`'s Roblox Open
   Cloud domain. The files to reflow are discoverable without any new core API:
   the codegen writer guarantees every generated file lands under one
   `codegen.output` root, and a deploy writes nothing else to the working tree
   (state is network-backed), so `git diff --name-only -- <codegen.output>`
   after a deploy yields the exact changed set.

## Decision

Ship commit-back as **GitHub Actions in a separate package**
(`@bedrock-rbx/actions`), built on public primitives, authenticated by a
**per-user GitHub App that each consumer creates and owns** — not a core
feature, not a hosted service, not a shared App.

- **No new `@bedrock-rbx/core` surface.** The reflow is a node24 JavaScript
  action that discovers changed files via a `codegen.output`-scoped `git diff`
  and pushes through an injected `GitExec` seam. Core stays pure Open Cloud.
- **Per-user App, created via the documented setup (or App Manifest).** Bedrock
  ships the required permissions (`contents: write`, no webhook) as a manifest
  and a how-to; the consumer creates their own App, installs it, stores
  `client-id` + `private-key` as secrets, and adds it to their branch-protection
  bypass. The deploy composite mints a short-lived installation token at run
  time via `actions/create-github-app-token` — nothing is hosted.
- **Two actions.** A lean **commit-back primitive** (the race-safe reflow) and a
  **deploy composite** (deploy → mint-or-accept token → commit-back), so
  consumers can adopt the drop-in or compose their own pipeline.

## Considered Options

- **Shared hosted "Bedrock bot" App** — rejected: requires distributing a
  private key (a secret leak), holds cross-org write tokens (trust liability),
  and runs counter to the zero-service stance behind gist-backed state.
- **Fine-grained PAT only** — workable but tied to a single human, expiring, and
  awkward org-wide; the very properties the App avoids. Still supported as a
  `commit-token` input for users who want it.
- **A Git port + `bedrock deploy --commit-back` in core** — rejected: pulls git,
  branch-protection, and push-retry semantics into an Open Cloud tool, a large
  foreign surface for an orthogonal concern.
- **Core reports its generated paths (new API)** — unnecessary: the
  `codegen.output`-scoped `git diff` already yields the exact set with no new
  public surface to maintain.

## Consequences

- The action runtime is **node24** (`runs.using: node24`), GitHub's zero-install
  JS host — deliberately *not* Bun, so consumers who run the Bedrock CLI under
  Node are not forced to install Bun. The action source therefore uses
  node-compatible APIs and is bundled (deps inlined) for that runtime.
- The bundled `dist` is **gitignored on `main`** and baked onto a disjoint
  `actions-v*` tag at release time, keeping the working tree clean and the dist
  commit off the signature-protected branches (see ADR-027 on
  `required_signatures`).
- The deploy composite references the primitive by an absolute, pinned ref
  (`…/packages/actions@actions-v1`); the moving major alias means v1.x releases
  need no edit, but a breaking `actions-v2` requires bumping that reference.
- Branch-protection bypass is a consumer setup step, documented but outside
  Bedrock's control; a misconfigured bypass surfaces as a failed push, which the
  primitive reports after exhausting its retries.
