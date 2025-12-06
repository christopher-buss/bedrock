# Bedrock Roadmap

This document outlines the high-level vision and priorities for Bedrock. For
detailed implementation plans, see `docs/plans/`. For individual tasks, see
[GitHub Issues](https://github.com/christopher-buss/bedrock/issues).

## Vision

Bedrock is a modern, TypeScript-based deployment tool for Roblox that:

1. **Uses only Open Cloud APIs** - No deprecated ROBLOSECURITY tokens
2. **Is accessible to contributors** - TypeScript instead of Rust
3. **Provides a smooth migration path** from Mantle
4. **Supports multiple configuration formats** - TypeScript, YAML, JSON

## Milestones

### v0.1 - Foundation (Current)

Deploy a real game using Bedrock. Prove the core workflow works.

**Scope:**

- Group ownership
- Branch-based environments
- Experience configuration (avatar settings, playable devices)
- Experience icon
- Game passes (name, description, price, icon)
- GitHub Gist state storage
- Mantle migration with warnings

**CLI Commands:**

- `bedrock init`
- `bedrock deploy`
- `bedrock diff`
- `bedrock migrate`
- `bedrock state`

### v0.2 - Expanded Resources

Add support for additional Roblox resources.

**Scope:**

- Developer products
- Places configuration
- Thumbnails

### v0.3 - State Backends

Add alternative state storage options.

**Scope:**

- Amazon S3 backend
- Cloudflare R2 backend
- Backend plugin interface

### v1.0 - Stable Release

Feature parity with Mantle (for Open Cloud-supported features).

**Scope:**

- Badges (if Open Cloud supports)
- Social links (if Open Cloud supports)
- Stable CLI interface
- Comprehensive documentation

## Future Considerations

These are ideas being tracked but not yet prioritized:

- **Plugin system** - Extensibility for custom resources, outputs, backends
- **Code generation** - Generate TypeScript/Luau code from config
- **Luau config support** - Support `bedrock.config.luau` via lute
- **Import command** - Import existing Roblox experiences (not migrating from
  Mantle)

## Non-Goals

Things Bedrock will intentionally not do:

- **Support ROBLOSECURITY** - Open Cloud only, by design
- **Host a state service** - Bedrock is open source; state storage is
  user-provided
- **Replace Rojo** - Bedrock handles deployment, not file syncing

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to get involved. Check
[GitHub Issues](https://github.com/christopher-buss/bedrock/issues) for current
work.
