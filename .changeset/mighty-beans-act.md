---
"@bedrock-rbx/core": patch
---

A config can declare an **Experience icon** with `universe.icon: { "en-us": path }` in TypeScript and Luau. A deploy uploads the image as the universe owner and sets it on the universe's live start place. Universe outputs record `iconAssetIds` and `iconStartPlaceId`. Bedrock uploads again only when the file changes, and sets the recorded image on a new start place without an upload when the start place changes. `icon: none` removes the icon; an omitted `icon` leaves it unmanaged. An upload that moderation is still reviewing emits one `iconPendingModeration` event, and the deploy succeeds. `createUniverseDriver` takes an optional `icon: { assets, readFile }`, which a config that declares `universe.icon` needs.
