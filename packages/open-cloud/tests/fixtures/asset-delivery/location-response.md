# Asset delivery capture

Captured 2026-11-09 with an API key that has `legacy-asset:manage`, from
`GET https://apis.roblox.com/asset-delivery-api/v1/assetId/{assetId}`.

- `location-response.json`: HTTP 200 for an image asset the key owner owns. The
  signed `contentdelivery.roblox.com` path, its `__token__` (expiry, acl, hmac)
  and `requestId` are replaced with stable fakes. Field shapes and types are
  preserved.
- `not-authorized-response.json`: an unowned public asset. HTTP **200** with an
  `errors` array (`code` 409, `customErrorCode` 1, "User is not authorized to
  access Asset.").
- `not-found-response.json`: a non-existent asset id. HTTP **200** with an
  `errors` array (`code` 404, `customErrorCode` 14, "Request asset was not
  found").

Thus the route reports asset errors in a 200 body, not in the HTTP status. A key
without the scope gets HTTP 403
`{"errors":[{"code":0,"message":"Scope not authorized."}]}`. The versioned route
(`.../version/1`) returned the same 200 shape.

The CDN `location` served `Content-Encoding: gzip` with
`Content-Type: application/octet-stream`, also when the request sent
`Accept-Encoding: identity`. After `fetch` decoded it, the body started with the
PNG signature (`89 50 4E 47`), not the gzip magic bytes `1f 8b`. No credentials
or request headers are stored.
