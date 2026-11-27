---
"@bedrock-rbx/core": patch
---

A config can declare a **Place icon** with `places.<key>.icon: { "en-us": path }` in TypeScript and Luau. A deploy uploads the image as the universe owner and sets it on that place, and place outputs record `iconAssetIds`. Bedrock uploads again only when the file changes. `icon: none` removes the icon; an omitted `icon` leaves it unmanaged. When `universe.icon` is set, the deploy does not write an icon to the live start place and emits a `startPlaceFieldSkipped` warning with `field: "icon"` naming the place key; a former start place gets its own icon back on the next deploy. An upload that moderation is still reviewing emits one `iconPendingModeration` event with `resourceKind: "place"`, and the deploy succeeds. `createPlaceDriver` takes an optional `icon: { assets, universes }`, which a place that declares `icon` needs.
