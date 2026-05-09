# ADR-004: Documentation Site

Date: 2025-12-12 Status: Accepted

Decision Makers: Maintainer Tags: documentation, vitepress, typedoc, vercel

## Context

Bedrock requires documentation for two distinct packages:

1. **Bedrock CLI** - User guides, configuration reference, deployment workflows
2. **@bedrock-rbx/ocale** - SDK for Roblox Open Cloud APIs, usable
   independently

Primary audience is Roblox developers deploying games. Internationalization
(i18n) is essential for global reach. Versioned documentation is nice to have
but not critical for initial release.

The project already uses VoidZero ecosystem tools (Vite, Vitest, Rolldown via
tsdown), making ecosystem alignment a consideration.

## Decision

Use **VitePress** for documentation with **TypeDoc** for API reference
generation, hosted on **Vercel**.

### Site Structure

Single documentation site with two main sections:

```text
bedrock.dev/
├── /               # Landing page
├── /cli/           # Bedrock CLI documentation
│   ├── guide/      # Getting started, tutorials
│   └── config/     # Configuration reference
└── /ocale/        # SDK documentation (renamed from /open-cloud/)
    ├── guide/      # Usage guides
    └── api/        # Auto-generated API reference
```

### Tooling

| Component             | Tool                              | Purpose                           |
| --------------------- | --------------------------------- | --------------------------------- |
| Static Site Generator | VitePress                         | Markdown rendering, theming, i18n |
| API Documentation     | TypeDoc + typedoc-plugin-markdown | TSDoc → Markdown generation       |
| Hosting               | Vercel                            | Free hosting, preview deployments |

### Content Strategy

- **CLI docs**: Hand-written markdown guides and configuration reference
- **Open Cloud docs**: Hand-written usage guides + auto-generated API reference
  from TSDoc comments
- **Interactive components**: Package manager tabs (npm/pnpm/bun) via Vue
  components

## Consequences

### Positive

- Ecosystem alignment with existing VoidZero tools (Vite, Vitest, Rolldown)
- Single codebase for all documentation, shared theme and i18n configuration
- API reference stays in sync with code via TSDoc generation
- Preview deployments on Vercel enable doc review in PRs
- VitePress has built-in i18n support for essential internationalization
- Same tooling as Vite, Vitest, Vue, Rolldown documentation sites

### Negative

- Custom interactive components require Vue (though most content is markdown)
- TypeDoc markdown output may need post-processing for VitePress compatibility
- Two documentation sections may require careful navigation design

### Neutral

- Custom landing page would require Vue components (or use default VitePress
  hero)
- Versioned docs possible via git branches but not built-in like Docusaurus

## Alternatives Considered

### Docusaurus

**Pros**: React-based (team familiarity), built-in versioning, built-in i18n,
mature ecosystem.

**Rejected because**: Heavier build, slower than VitePress, different ecosystem
from existing tooling (Vite, Vitest). React familiarity is less relevant since
most content is markdown.

### Fumadocs (Next.js)

**Pros**: React/Next.js based, excellent TypeDoc integration, TypeScript-first,
modern.

**Rejected because**: Ties documentation to Next.js/Vercel ecosystem rather than
VoidZero ecosystem. Would introduce Next.js as a dependency for docs only.

### Two Separate Sites

**Pros**: Complete separation of concerns, independent deployments.

**Rejected because**: Duplicate infrastructure, harder to maintain consistent
branding and i18n, CLI and Open Cloud docs share enough context to benefit from
unified navigation.

### GitHub Pages (hosting)

**Pros**: Simplest setup, integrated with repository.

**Rejected because**: No preview deployments for PRs, which are valuable for
reviewing documentation changes before merge.

## Implementation Notes

- VitePress config in `apps/website/.vitepress/config.ts`
- TypeDoc generates markdown to `apps/website/docs/open-cloud/api/`
- Build pipeline: TypeDoc runs before VitePress build
- i18n structure follows VitePress conventions (`/` for English, `/zh/` for
  Chinese, etc.)
- Package manager tabs via `vitepress-plugin-tabs` or custom Vue component

## Related Decisions

- ADR-001: TypeScript with Bun Runtime
- ADR-002: Monorepo with FCIS Architecture

## References

- [VitePress Documentation](https://vitepress.dev/)
- [VitePress i18n](https://vitepress.dev/guide/i18n)
- [TypeDoc](https://typedoc.org/)
- [typedoc-plugin-markdown](https://github.com/tgreyuk/typedoc-plugin-markdown)
- [Vercel Documentation](https://vercel.com/docs)

## Amendments

- **2026-04-17:** The `@bedrock-rbx/ocale` package was renamed to
  `@bedrock-rbx/ocale`. URL path is now `/ocale/` (not `/open-cloud/`) and TypeDoc
  emits to `apps/website/docs/ocale/api/`. The directory `packages/open-cloud/`
  retains its original name.

- **2026-04-29:** Production docs deploy on release tags, not `main`. The
  Vercel project at `bedrock-livid.vercel.app` is driven by
  `.github/workflows/website-release.yaml`, which fires on push of a tag
  matching `@bedrock-rbx/core@*` (the Changesets default), checks out the tagged
  commit, and runs `vercel pull` / `vercel build --prod` /
  `vercel deploy --prebuilt --prod`. Required repo secrets: `VERCEL_TOKEN`,
  `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`. The dashboard's git integration for
  this project must have auto-deploy on `main` disabled. A second Vercel
  project tracks `main` for previewing unreleased work; it builds with the
  environment variable `BEDROCK_DOCS_CHANNEL=next`, which the VitePress
  config consumes to prefix the title (`Bedrock (preview)`) and add a "Latest
  release" link to the navbar pointing back at production. The site remains
  single-version; a version switcher is deferred until the API stabilizes
  at 1.0. Issue #137.
