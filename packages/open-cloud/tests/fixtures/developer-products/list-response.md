# Developer product list capture

Captured 2026-11-09 with an API key from the Open Cloud endpoint:
`GET https://apis.roblox.com/developer-products/v2/universes/{universeId}/developer-products/creator?pageSize=50`.
`list-response.json` is the sanitized full successful body (45 products, final
null cursor). Product, universe and icon IDs, names and descriptions are
replaced with stable fakes; field shapes, types and nulls are preserved. No
credentials or request headers are stored.

Read-only boundary probes against the same universe returned HTTP 200 for
`pageSize=400` and HTTP 400 for `pageSize=401`, with `InvalidPageSize` and "Page
size must be less than or equal to 400." Thus the observed maximum is 400. The
vendored OpenAPI documents the default as 50 but omits the maximum.
