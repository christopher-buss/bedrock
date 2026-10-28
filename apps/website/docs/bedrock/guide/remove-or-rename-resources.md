# Remove or rename resources

Bedrock never forgets a resource on its own. When a game pass, developer
product, or place is in an environment's state but no longer in your config, it
is an **orphan**, and `diff`, `provision`, and `deploy` stop before any change
reaches Roblox. This guide shows how to tell bedrock what you meant.

## Retire a resource

Replace the entry with `retired: true`. A retired entry carries no other field.

```ts
import { defineConfig } from "@bedrock-rbx/core/config";

export default defineConfig({
	environments: { production: {} },
	passes: {
		"double-xp": { retired: true },
	},
});
```

```luau
local bedrock = require("@bedrock/config")

return bedrock.defineConfig({
	environments = { production = {} },
	passes = {
		["double-xp"] = { retired = true },
	},
})
```

Roblox Open Cloud cannot delete these items, so bedrock hides each one as far as
the API allows, then drops it from state:

| Kind              | What retirement does                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Game pass         | Renames it `zzz_DEPRECATED(<UTC timestamp>)`, clears the description, takes it off sale, replaces every icon with a placeholder |
| Developer product | Same as a game pass; it goes off sale through the off-sale flag, not a price change                                             |
| Place             | Renames it `zzz_DEPRECATED(<UTC timestamp>)`, clears the description, sets the server size to 1                                 |

The name format is the one Mantle used, so items retired by either tool sort
together at the bottom of the Creator Dashboard. Game passes and developer
products retired in one run get distinct timestamps.

Bedrock refuses to retire:

- the universe: "Universe removal is not available at this time.";
- the root place, because Roblox derives the experience name and description
  from it;
- a place whose `placeId` another entry in the config still adopts.

Each refusal stops the run before any operation.

## Stop managing a resource without changing it

Replace the entry with `retired: "untrack"`. Bedrock drops the resource from
state and leaves the live item exactly as it is.

```ts
import { defineConfig } from "@bedrock-rbx/core/config";

export default defineConfig({
	environments: { production: {} },
	products: {
		"starter-pack": { retired: "untrack" },
	},
});
```

```luau
local bedrock = require("@bedrock/config")

return bedrock.defineConfig({
	environments = { production = {} },
	products = {
		["starter-pack"] = { retired = "untrack" },
	},
})
```

## Rename a key

Put `movedFrom: "<old key>"` on the new entry. Bedrock moves the old key's state
to the new key before it compares config with state, so the live item keeps its
Roblox ID and receives an ordinary update.

```ts
import { defineConfig } from "@bedrock-rbx/core/config";

export default defineConfig({
	environments: { production: {} },
	passes: {
		"vip-plus": {
			name: "VIP+",
			description: "Every VIP perk and more.",
			icon: { "en-us": "assets/vip.png" },
			movedFrom: "vip",
		},
	},
});
```

```luau
local bedrock = require("@bedrock/config")

return bedrock.defineConfig({
	environments = { production = {} },
	passes = {
		["vip-plus"] = {
			name = "VIP+",
			description = "Every VIP perk and more.",
			icon = { ["en-us"] = "assets/vip.png" },
			movedFrom = "vip",
		},
	},
})
```

`movedFrom` works on the root entry of a game pass, developer product, or place.
It is not accepted on the universe or inside an environment overlay. In an
environment that has no state for the old key, it does nothing and the entry
diffs as usual. Bedrock rejects the run when:

- the old key is still declared in config;
- both keys already have state;
- two entries name the same old key;
- the old key belongs to a different kind.

A place needs no `movedFrom` when its `placeId` is unchanged: a new place entry
whose `placeId` matches an orphaned place takes over that place's state.

## Apply a marker to one environment

A `retired` marker on a root entry applies to every environment. Put it in an
environment overlay to apply it there only:

```ts
import { defineConfig } from "@bedrock-rbx/core/config";

export default defineConfig({
	environments: {
		production: {},
		staging: { passes: { "double-xp": { retired: true } } },
	},
	passes: {
		"double-xp": {
			name: "Double XP",
			description: "Twice the XP for an hour.",
			icon: { "en-us": "assets/double-xp.png" },
		},
	},
});
```

A root `retired` entry cannot be combined with overlay fields: an overlay under
a retired root entry may only set `retired`. A marker for a key with no state in
the selected environment is a no-op, so an item that is already retired, or was
never created there, does not fail the run.

## Fix the orphan error

With the default settings, removing an entry from config fails the run:

```text
Unresolved orphans: gamePass:double-xp. Restore each entry with retired: true to retire it, retired: "untrack" to stop managing it without changing Roblox, or movedFrom on its new entry to preserve its Roblox ID.
```

Pick one fix per orphan:

1. Restore the key as `{ retired: true }` to retire the live item.
2. Restore the key as `{ retired: "untrack" }` to leave the live item alone.
3. Add `movedFrom: "<old key>"` to the entry that replaced it.

## Retire every orphan automatically

Set `orphans: "retire"` to get Mantle's behaviour: every unresolved orphan is
retired as if it had `retired: true`.

```ts
import { defineConfig } from "@bedrock-rbx/core/config";

export default defineConfig({
	environments: { production: {} },
	orphans: "retire",
});
```

```luau
local bedrock = require("@bedrock/config")

return bedrock.defineConfig({
	environments = { production = {} },
	orphans = "retire",
})
```

Renames resolve first, and the universe and root-place refusals still apply. The
default is `orphans: "error"`.

## Know when to delete a marker

`retired` and `movedFrom` lines are temporary. After each `diff` and `deploy`,
bedrock reads every environment's state and reports each line:

```text
gamePass:double-xp retired: Still active in: staging.
gamePass:vip-plus movedFrom "vip": Safe to drop declaration (absent from every environment's persisted state).
```

Delete a line once it is safe to drop. `Still active in` lists the environments
that still need a deploy, and `Unknown in` lists environments whose state could
not be read.
