# Place icon captures

Captured 2026-11-27 with an API key that has `asset:read` and `asset:write`,
using `scripts/probe-place-icon.ts` against the start place of a user-owned test
universe. The universe, place, image and user IDs, the operation IDs and the
display names are replaced with stable fakes (`123`, `456`, `789`, `111`,
`00000000-…-000000000001`/`…02`, `Test Place`, `Test Icon`). Field shapes,
types, timestamps and which fields are present or absent are kept. No request
headers are stored.

- `create-image-response.json`: `POST /assets/v1/assets` for a 512x512 PNG with
  `assetType: "Image"`, `creationContext.creator.userId` set to the universe
  owner and `assetPrivacy: "OpenUse"`. HTTP 200, an operation with `done: false`
  and no `response`.
- `create-image-operation-done-response.json`: the first
  `GET /assets/v1/operations/{operationId}` poll. `done: true`, and `response`
  is the new image asset. Its `moderationResult.moderationState` was already
  `Approved`. The empty `description` is absent, and there is no `metadata`
  field.
- `update-icon-response.json`:
  `PATCH /assets/v1/assets/{placeId}?updateMask=icon` with only a `request`
  part, `{ "assetId": "<placeId>", "icon": "assets/<imageId>" }`, and no
  `fileContent`. HTTP 200, an operation with `done: false`. No Access
  Permissions grant was made for the image first.
- `update-icon-operation-done-response.json`: the first poll of that operation.
  `response` is the place asset, but it does **not** contain `icon`, and
  `revisionId` did not change.
- `get-place-response.json`: `GET /assets/v1/assets/{placeId}` with no
  `readMask`. It never contains `icon`, even when the place has one.
- `get-place-icon-response.json`: the same GET with `readMask=icon` after the
  update: `{ "icon": "assets/<imageId>" }`.
- `get-place-icon-empty-response.json`: `readMask=icon` on a place with no icon:
  `{}`. The field is absent, not `null`, although the spec marks it nullable.
- `get-place-wide-mask-response.json`:
  `readMask=icon,previews,description,displayName` on a place with no icon and
  an empty description. A `readMask` response holds only the masked fields that
  have a value. It has no `path` or `assetId`.

Removal: the same PATCH with `"icon": ""` returned the same operation shapes,
and `readMask=icon` then returned `{}` again.

Rate-limit headers (`x-ratelimit-limit` per 60 s): asset POST and PATCH 120,
asset GET 600, operation GET 300. No 429 occurred.

The universe read (`GET /cloud/v2/universes/{universeId}`) named the owner as
`"user": "users/<id>"` (a group-owned universe has `group` instead) and returned
`templateRootPlace: ""`, which the spec marks `writeOnly`.

`create-image-operation-failed-response.json` is hand-built, not captured: the
probe never produced a failed operation. It follows `AssetsUploadApi.Operation`
in the vendored spec, with `done: true`, an `AssetsUploadApi.Status` `error` and
no `response`. The `code` and `message` values are invented. Replace it with a
capture when a live failure is seen.
