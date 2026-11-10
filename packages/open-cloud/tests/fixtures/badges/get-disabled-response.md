# Disabled badge get capture

Captured 2026-11-10 with an unauthenticated request (no credential, no cookie)
to `GET https://badges.roblox.com/v1/badges/{badgeId}` for a disabled badge
(`isActive=false`) created for this capture in a test universe.
`get-disabled-response.json` is the sanitized full successful body. Badge, icon,
universe and root place IDs, badge names and descriptions, and the universe name
are replaced with stable fakes. Field shapes, types, timestamps (with `+00:00`,
not `Z`) and statistics are kept. No request headers are stored.

The response carried `x-ratelimit-limit: 600, 600;w=60`.

At the same time,
`GET https://badges.roblox.com/v1/universes/{universeId}/badges?limit=100` for
the same universe returned no items and null cursors. The disabled badge was the
only badge in the universe, so the list hides disabled badges.
