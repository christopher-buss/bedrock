# Bedrock Design Document

**Date:** 2025-12-06 **Status:** Draft - Pending Approval

## Overview

Bedrock is a TypeScript-based infrastructure-as-code and deployment tool for
Roblox, designed as a modern alternative to
[Mantle](https://github.com/blake-mealey/mantle). With Mantle's creator stepping
away from maintenance, Bedrock aims to provide a familiar experience while being
accessible to developers who work in TypeScript.

## Problem Statement

Mantle is written in Rust, making it difficult for the broader Roblox community
to contribute. Additionally, Mantle relies on ROBLOSECURITY tokens for some
features, which Roblox is actively deprecating. Bedrock addresses both issues
by:

1. Using TypeScript for familiarity and contribution accessibility
2. Using Open Cloud APIs exclusively (no ROBLOSECURITY)

## Design Decisions

### Language: TypeScript

- Familiar to roblox-ts developers and the broader web community
- Enables contribution without learning Rust
- Rich ecosystem (c12, commander, etc.)

**ADR needed:** Formal validation of TypeScript as the right choice.

### Authentication: Open Cloud Only

Bedrock will exclusively use Roblox Open Cloud APIs. Features not available via
Open Cloud will not be supported.

**Rationale:**

- ROBLOSECURITY is being phased out by Roblox
- Open Cloud is the officially supported API surface
- Simpler security model (API keys vs session tokens)

**Trade-off:** Some Mantle features may not be available until Roblox adds Open
Cloud support.

### Configuration: Multi-Format Support

Support multiple configuration formats via [c12](https://github.com/unjs/c12):

| Format     | File                | Use Case                       |
| ---------- | ------------------- | ------------------------------ |
| TypeScript | `bedrock.config.ts` | Full type safety, autocomplete |
| JavaScript | `bedrock.config.js` | Node.js without TypeScript     |
| YAML       | `bedrock.yaml`      | Simple, Mantle-familiar        |
| JSON       | `bedrock.json`      | Machine-readable               |

All formats share the same schema. JSON Schema will be generated for YAML/JSON
autocomplete.

**Example TypeScript config:**

```typescript
import { defineConfig } from "bedrock";

export default defineConfig({
	environments: [
		{ branches: ["live"], label: "production", targetAccess: "private" },
		{ branches: ["staging"], label: "staging", targetAccess: "private" },
		{ branches: ["main"], label: "development", targetAccess: "private" },
	],

	owner: { group: 34745987 },

	target: {
		experience: {
			configuration: {
				avatarType: "playerChoice",
				playableDevices: ["computer", "console", "phone", "tablet"],
			},
			icon: "images/icons/game-icon.png",
			passes: {
				"vip-pass": {
					name: "VIP Pass",
					description: "Get exclusive VIP benefits!",
					icon: "images/passes/vip.png",
					price: 399,
				},
			},
		},
	},
});
```

### State Storage: GitHub Gists (Default)

State will be stored in GitHub Gists by default, with extensibility for other
backends.

**Why Gists:**

- Zero external service setup (just GitHub)
- Works with existing `GITHUB_TOKEN` in CI
- Version history built-in
- Easy to debug (view in browser)
- 1MB limit is sufficient for deployment state

**State contents:**

```json
{
	"experience": { "id": "123456789" },
	"passes": {
		"vip-pass": { "id": "111222333", "lastUpdated": "2025-12-06" }
	}
}
```

**Security consideration:** State contains Roblox resource IDs which are already
public. No secrets are stored in state.

**Future backends:**

- Amazon S3
- Cloudflare R2
- Custom backends via plugin

### Environments: Branch-Based

Following Mantle's approach, environments are determined by Git branch:

```yaml
environments:
  - branches: [live]
    label: production
    targetAccess: private

  - branches: [staging]
    label: staging
    targetAccess: private

  - branches: [main]
    label: development
    targetAccess: private
```

When deploying from the `staging` branch, the staging environment configuration
is used automatically.

## CLI Commands

### MVP Commands

| Command           | Description                            |
| ----------------- | -------------------------------------- |
| `bedrock init`    | Create config file, set up state gist  |
| `bedrock deploy`  | Deploy changes to Roblox               |
| `bedrock diff`    | Validate config and preview changes    |
| `bedrock migrate` | Convert `mantle.yml` to bedrock config |
| `bedrock state`   | View current state (read-only)         |

### Future Commands

| Command            | Description                                          |
| ------------------ | ---------------------------------------------------- |
| `bedrock import`   | Import existing Roblox experience into config        |
| `bedrock generate` | Generate TS/Lua output code (requires plugin system) |

## v0.1 Scope

The initial release will support the features needed to deploy a real game
(anime-rush):

### Included

- [ ] Group ownership
- [ ] Branch-based environments
- [ ] Experience configuration (avatar settings, playable devices)
- [ ] Experience icon
- [ ] Game passes (name, description, price, icon)
- [ ] GitHub Gist state storage
- [ ] Mantle migration with warnings for unsupported features

### Excluded (Future)

- Developer products
- Badges
- Thumbnails
- Social links
- Places configuration (beyond main place)
- S3/R2 state backends
- Plugin system
- Code generation (TS/Lua output)

## Migration from Mantle

`bedrock migrate` will:

1. Parse existing `mantle.yml`
2. Convert to `bedrock.config.ts` (or chosen format)
3. Warn about unsupported features (badges, features requiring ROBLOSECURITY)
4. Generate state from existing Mantle state file

## Open Questions

1. **Luau config support:** Should we support `bedrock.config.luau` via
   [lute](https://github.com/luau-lang/lute)? Adds complexity but feels native
   for Luau projects.

2. **Plugin architecture:** How should plugins work for code generation and
   custom state backends?

3. **Open Cloud API coverage:** Need to validate which Mantle features are
   available via Open Cloud as of December 2025.

## References

- [Mantle Documentation](https://mantledeploy.vercel.app/)
- [Mantle GitHub](https://github.com/blake-mealey/mantle)
- [Roblox Open Cloud Reference](https://create.roblox.com/docs/cloud/reference)
- [c12 - Smart Configuration Loader](https://github.com/unjs/c12)
