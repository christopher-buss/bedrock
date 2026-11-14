# Badge metadata capture

Captured 2026-11-14 with an unauthenticated request (no credential, no cookie)
to `GET https://badges.roblox.com/v1/badges/metadata`. `metadata-response.json`
is the full successful body. It holds no user, universe or badge data, so
nothing is replaced. `defaultBadgeIconImageId` is the public default badge icon.
No request headers are stored.

The response carried `x-ratelimit-limit: 100, 100;w=60`. The vendored spec
declares no rate limit for this operation.
