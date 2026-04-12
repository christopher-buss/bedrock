# ADR-004: Multi-Format Configuration

**Date:** 2025-12-06 **Status:** Accepted

## Context

Bedrock needs a configuration format that:

1. Is accessible to both roblox-ts and Luau developers
2. Provides good developer experience (autocomplete, validation)
3. Supports migration from Mantle's YAML format
4. Allows programmatic configuration (variables, conditionals)

## Decision

Bedrock will support **multiple configuration formats** via
[c12](https://github.com/unjs/c12):

| Format     | File                | Use Case                       |
| ---------- | ------------------- | ------------------------------ |
| TypeScript | `bedrock.config.ts` | Full type safety, autocomplete |
| JavaScript | `bedrock.config.js` | Node.js without TypeScript     |
| YAML       | `bedrock.yaml`      | Simple, Mantle-familiar        |
| JSON       | `bedrock.json`      | Machine-readable               |

All formats share the same schema.

## Consequences

### Positive

- **Accessibility**: Luau developers unfamiliar with TypeScript can use YAML
- **Migration**: YAML format eases transition from Mantle
- **Power users**: TypeScript config enables variables, conditionals, imports
- **IDE support**: JSON Schema provides autocomplete for YAML/JSON
- **Type safety**: TypeScript users get full compile-time validation

### Negative

- **Maintenance**: Multiple formats to test and document
- **Complexity**: c12 adds a dependency
- **Edge cases**: Format-specific behaviors may differ slightly

### Mitigations

- **Single schema**: All formats validate against the same TypeScript types
- **Generated schema**: JSON Schema auto-generated from TypeScript for
  consistency
- **c12 maturity**: Widely used in the unjs ecosystem (Nuxt, Nitro)

## Example Configurations

### TypeScript (`bedrock.config.ts`)

```typescript
import { defineConfig } from "bedrock";

const THANKS_MSG = "Thanks for supporting!";

export default defineConfig({
	owner: { group: 34745987 },
	target: {
		experience: {
			passes: {
				vip: {
					name: "VIP Pass",
					description: `VIP benefits!\n\n${THANKS_MSG}`,
					price: 399,
				},
			},
		},
	},
});
```

### YAML (`bedrock.yaml`)

```yaml
owner:
  group: 34745987

target:
  experience:
    description: |
      VIP benefits!

      Thanks for supporting!
    passes:
      vip:
        name: VIP Pass
    price: 399
```

## Alternatives Considered

### TypeScript Only

Maximum type safety and consistency.

**Rejected because:**

- Excludes Luau developers unfamiliar with TypeScript
- Harder migration from Mantle's YAML

### YAML Only (like Mantle)

Maximum simplicity and migration compatibility.

**Rejected because:**

- No type safety or autocomplete
- Can't use variables or conditionals
- Doesn't align with TypeScript-first ecosystem

### Luau Config (`bedrock.config.luau`)

Native to Roblox developers.

**Deferred because:**

- Requires [lute](https://github.com/luau-lang/lute) runtime
- Adds complexity
- May be added later via plugin system

## References

- [c12 - Smart Configuration Loader](https://github.com/unjs/c12)
- [Mantle Configuration](https://mantledeploy.vercel.app/docs/configuration)
