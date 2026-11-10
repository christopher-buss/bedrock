# Badge list capture

Captured 2026-11-09 with unauthenticated requests (no credential, no cookie) to
`GET https://badges.roblox.com/v1/universes/{universeId}/badges?limit=10&sortOrder=Asc`
for a large public universe, following the cursor to the end.

- `list-page-1-response.json`: the first page. It holds 7 badges, not 10, and a
  non-null `nextPageCursor`. So a page can hold fewer items than `limit` and
  still have a next page. A likely cause is that the server drops disabled
  badges after it cuts the page; the capture does not prove this.
- `list-page-2-response.json`: the second and last page. It holds no badges and
  a null `nextPageCursor`.

Badge, icon, universe and root place IDs, badge names and descriptions, and the
universe name are replaced with stable fakes. The opaque cursor is replaced with
`test-cursor-page-2`. Field shapes, types, nulls, timestamps and statistics are
kept. No request headers are stored.

The responses carried `x-ratelimit-limit: 100, 100;w=60`.

`get-disabled-response.md` records observed evidence that the list hides
disabled badges.
