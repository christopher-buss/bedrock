# Which Open Cloud operations accept an OAuth bearer

Research for issue #681 (map #680). Date: 2026-10-19.

## Answer

1. Every Operation ocale binds today accepts an OAuth 2.0 access token, except
   three groups: place publish, Luau execution, and memory store. The legacy
   badge, localization, experience icon and thumbnail endpoints all accept
   OAuth. They are in the schema, each with its own `legacy-*` OAuth scope.
2. For every Operation that accepts OAuth, `perOauth2Authorization` is the same
   as `perApiKeyOwner`. The two limits count against different buckets (see
   [Rate limits](#rate-limits)).
3. Roblox does not document what a resource server returns for a bad bearer. The
   documented error tables give only general codes. A live call must settle all
   four cases (see [Live-probe items](#live-probe-items)).

## Sources

- **S1**: `packages/open-cloud/vendor/roblox-openapi.json`, pinned to
  Roblox/creator-docs commit `e622b54`. Per operation: `security` and
  `x-roblox-rate-limits`.
- **S2**: The upstream `content/en-us/reference/cloud/openapi.json` at
  Roblox/creator-docs commit
  [`70a0110`](https://github.com/Roblox/creator-docs/blob/70a0110fee0c0900103e545fcaee69a8bd2a942f/content/en-us/reference/cloud/openapi.json)
  (2026-10-17). This version names the OAuth scope in `security` for each
  operation. S1 has an empty list there for the legacy endpoints. The
  accept/reject answer and the limits are the same in S1 and S2 for every row
  below.
- **S3**:
  [Rate limits](https://create.roblox.com/docs/cloud/reference/rate-limits)
  (`content/en-us/cloud/reference/rate-limits.md`).
- **S4**: [Errors](https://create.roblox.com/docs/cloud/reference/errors)
  (`content/en-us/cloud/reference/errors.md`).
- **S5**:
  [OAuth 2.0 reference](https://create.roblox.com/docs/cloud/auth/oauth2-reference)
  and
  [registration](https://create.roblox.com/docs/cloud/auth/oauth2-registration)
  (`content/en-us/cloud/auth/`).
- **S6**:
  [Place publishing guide](https://create.roblox.com/docs/cloud/guides/usage-place-publishing)
  (`content/en-us/cloud/guides/usage-place-publishing.md`).
- **S7**: A live call by a bedrock consumer (recorded on #680): a bearer on
  place publish returned 401.

The Operation list comes from the `url:` templates in the request builders under
`packages/open-cloud/src/domains/`.

## Operations

"Same" in the last column means the two limits have equal numbers. "OAuth scope"
is the scope that S2 names for that operation. For `cloud/v2` paths it and for
`GET .../game-icon/games/{universeId}` it is the `x-roblox-scopes` value,
because `security` names no scope there.

| Operation                                                                                                             | Accepts OAuth | Source         | OAuth scope                                    | API-key limit | OAuth limit    |
| --------------------------------------------------------------------------------------------------------------------- | ------------- | -------------- | ---------------------------------------------- | ------------- | -------------- |
| `POST /legacy-badges/v1/universes/{universeId}/badges`                                                                | yes           | S1, S2         | `legacy-universe.badge:manage-and-spend-robux` | 100/min       | 100/min (same) |
| `PATCH /legacy-badges/v1/badges/{badgeId}`                                                                            | yes           | S1, S2         | `legacy-universe.badge:write`                  | 100/min       | 100/min (same) |
| `POST /legacy-publish/v1/badges/{badgeId}/icon`                                                                       | yes           | S1, S2         | `legacy-badge:manage`                          | 100/min       | 100/min (same) |
| `POST /legacy-game-internationalization/v1/badges/{id}/icons/language-codes/{lc}`                                     | yes           | S1, S2         | `legacy-badge:manage`                          | 100/min       | 100/min (same) |
| `PATCH /legacy-game-internationalization/v1/badges/{id}/name-description/language-codes/{lc}`                         | yes           | S1, S2         | `legacy-badge:manage`                          | 100/min       | 100/min (same) |
| `POST /legacy-game-internationalization/v1/developer-products/{id}/icons/language-codes/{lc}`                         | yes           | S1, S2         | `legacy-developer-product:manage`              | 100/min       | 100/min (same) |
| `PATCH /legacy-game-internationalization/v1/developer-products/{id}/name-description/language-codes/{lc}`             | yes           | S1, S2         | `legacy-developer-product:manage`              | 100/min       | 100/min (same) |
| `POST /legacy-game-internationalization/v1/game-passes/{id}/icons/language-codes/{lc}`                                | yes           | S1, S2         | `legacy-game-pass:manage`                      | 100/min       | 100/min (same) |
| `PATCH /legacy-game-internationalization/v1/game-passes/{id}/name-description/language-codes/{lc}`                    | yes           | S1, S2         | `legacy-game-pass:manage`                      | 100/min       | 100/min (same) |
| `GET /legacy-game-internationalization/v1/game-icon/games/{universeId}`                                               | yes           | S1, S2         | `legacy-universe:manage`                       | 100/min       | 100/min (same) |
| `POST /legacy-game-internationalization/v1/game-icon/games/{universeId}/language-codes/{lc}`                          | yes           | S1, S2         | `legacy-universe:manage`                       | 100/min       | 100/min (same) |
| `DELETE /legacy-game-internationalization/v1/game-icon/games/{universeId}/language-codes/{lc}`                        | yes           | S1, S2         | `legacy-universe:manage`                       | 100/min       | 100/min (same) |
| `POST /legacy-game-internationalization/v1/game-thumbnails/games/{universeId}/language-codes/{lc}/image`              | yes           | S1, S2         | `legacy-universe:manage`                       | 100/min       | 100/min (same) |
| `DELETE /legacy-game-internationalization/v1/game-thumbnails/games/{universeId}/language-codes/{lc}/images/{imageId}` | yes           | S1, S2         | `legacy-universe:manage`                       | 100/min       | 100/min (same) |
| `POST /legacy-game-internationalization/v1/game-thumbnails/games/{universeId}/language-codes/{lc}/images/order`       | yes           | S1, S2         | `legacy-universe:manage`                       | 100/min       | 100/min (same) |
| `POST /universes/v1/{universeId}/places/{placeId}/versions` (place publish)                                           | **no**        | S1, S2, S6, S7 | none (API key: `universe-places:write`)        | 30/min        | none           |
| `GET /game-passes/v1/universes/{universeId}/game-passes/creator`                                                      | yes           | S1, S2         | `game-pass:read`                               | 10/s          | 10/s (same)    |
| `GET /game-passes/v1/universes/{universeId}/game-passes/{id}/creator`                                                 | yes           | S1, S2         | `game-pass:read`                               | 10/s          | 10/s (same)    |
| `POST /game-passes/v1/universes/{universeId}/game-passes`                                                             | yes           | S1, S2         | `game-pass:write`                              | 5/s           | 5/s (same)     |
| `PATCH /game-passes/v1/universes/{universeId}/game-passes/{id}`                                                       | yes           | S1, S2         | `game-pass:write`                              | 5/s           | 5/s (same)     |
| `GET /developer-products/v2/universes/{universeId}/developer-products/{id}/creator`                                   | yes           | S1, S2         | `developer-product:read`                       | 10/s          | 10/s (same)    |
| `POST /developer-products/v2/universes/{universeId}/developer-products`                                               | yes           | S1, S2         | `developer-product:write`                      | 3/s           | 3/s (same)     |
| `PATCH /developer-products/v2/universes/{universeId}/developer-products/{id}`                                         | yes           | S1, S2         | `developer-product:write`                      | 3/s           | 3/s (same)     |
| `GET /cloud/v2/universes/{universeId}`                                                                                | yes           | S1, S2         | none listed                                    | 100/min       | 100/min (same) |
| `PATCH /cloud/v2/universes/{universeId}`                                                                              | yes           | S1, S2         | `universe:write`                               | 100/min       | 100/min (same) |
| `POST /cloud/v2/universes/{universeId}:restartServers`                                                                | yes           | S1, S2         | `universe:write`                               | 30/min        | 30/min (same)  |
| `PATCH /cloud/v2/universes/{universeId}/places/{placeId}`                                                             | yes           | S1, S2         | `universe.place:write`                         | 100/min       | 100/min (same) |
| `GET /server-management/v1/universes/{universeId}/restarts:forecast`                                                  | yes           | S1, S2         | `universe:read`                                | 100/min       | 100/min (same) |
| `GET /server-management/v1/universes/{universeId}/restarts`                                                           | yes           | S1, S2         | `universe:read`                                | 100/min       | 100/min (same) |
| `POST /server-management/v1/universes/{universeId}/restarts`                                                          | yes           | S1, S2         | `universe:write`                               | 100/min       | 100/min (same) |
| `POST /cloud/v2/universes/{universeId}/luau-execution-session-task-binary-inputs`                                     | **no**        | S1, S2         | none                                           | 5/min         | none           |
| `POST /cloud/v2/universes/{universeId}/places/{placeId}/luau-execution-session-tasks`                                 | **no**        | S1, S2         | none                                           | 5/min         | none           |
| `POST /cloud/v2/universes/{universeId}/places/{placeId}/versions/{versionId}/luau-execution-session-tasks`            | **no**        | S1, S2         | none                                           | 5/min         | none           |
| `GET .../luau-execution-sessions/{sessionId}/tasks/{taskId}`                                                          | **no**        | S1, S2         | none                                           | 200/min       | none           |
| `GET .../luau-execution-sessions/{sessionId}/tasks/{taskId}/logs`                                                     | **no**        | S1, S2         | none                                           | 45/min        | none           |
| `POST /cloud/v2/universes/{universeId}/memory-store/queues/{queueId}/items`                                           | **no**        | S1, S2         | none                                           | 1,000,000/min | none           |
| `GET /cloud/v2/universes/{universeId}/memory-store/queues/{queueId}/items:read`                                       | **no**        | S1, S2         | none                                           | 1,000,000/min | none           |
| `POST /cloud/v2/universes/{universeId}/memory-store/queues/{queueId}/items:discard`                                   | **no**        | S1, S2         | none                                           | 1,000,000/min | none           |
| `GET/POST /cloud/v2/universes/{universeId}/memory-store/sorted-maps/{mapId}/items`                                    | **no**        | S1, S2         | none                                           | 1,000,000/min | none           |
| `GET/PATCH/DELETE /cloud/v2/universes/{universeId}/memory-store/sorted-maps/{mapId}/items/{itemId}`                   | **no**        | S1, S2         | none                                           | 1,000,000/min | none           |

Notes on the table:

- The map (#680) says the legacy endpoints are not in the vendored schema. They
  are. S1 lists each one with `roblox-oauth2`. S2 adds the scope name.
- For `PATCH /legacy-badges/v1/badges/{badgeId}`, S2 lists two scopes:
  `legacy-universe.badge:write` and
  `legacy-universe.badge:manage-and-spend-robux`. The OpenAPI `security`
  semantics make that a choice of either one.
- Place publish is API-key only in S1 and S2. The place publishing guide (S6)
  documents an API key only. This agrees with the 401 in S7. No Roblox source
  announces OAuth support for place publish.
- Luau execution and memory store are API-key only in S1 and S2.
- A scope in the schema does not prove that an OAuth app can select it. S5 says
  the scopes of an app "must fall under a single app category", and that Roblox
  approves scopes when it reviews a public app. No Roblox source lists which
  category holds the `legacy-*` scopes. This is a live-probe item.

## Rate limits

S3 defines two different buckets:

- **API key**: "applied across all API keys per owner, which can be either a
  user or a group." One bucket for each owner.
- **OAuth 2.0**: "applied per access token. Since each access token represents a
  unique combination of user and application, every user using your app receives
  their own independent rate limit quota."

Consequences for ocale:

- The numbers are the same, but the bucket key is different. ocale keys its
  rate-limit queues on the raw `apiKey`
  (`packages/open-cloud/src/internal/resource-client.ts`). An OAuth credential
  needs a key for its own bucket.
- S3 says "per access token", but an access token lasts only 15 minutes (S5). S3
  also says a token "represents a unique combination of user and application",
  and the schema field is named `perOauth2Authorization`. Thus the bucket is
  probably per authorization, and a refresh probably does not reset it. No
  source states this. This is a live-probe item.
- No source says if an OAuth call and an API-key call from the same user share a
  bucket. The text above implies that they do not.

## Bad-token responses

Roblox documents no resource-server response for a bad bearer. These are the
facts that the sources give:

- **Gateway errors** (S4): "For authentication or routing issues", v1 and v2
  APIs "may return" a body like
  `{"errors":[{"code":0,"message":"Invalid API Key"}]}`. S4 gives no HTTP status
  and no OAuth example.
- **Scope errors** (S4): the v1 table lists 403 `INSUFFICIENT_SCOPE`, "The
  request requires higher privileges than provided by the access token", and 403
  `PERMISSION_DENIED`. The v2 table lists only 403 `PERMISSION_DENIED`.
- **Revoked tokens** (S5): a revoked access token is invalid at once ("Can be
  invalidated before it expires if an app user revokes the authorization"). But
  `POST /oauth/v1/token/introspect` still reports `active: true` for it until
  the 15 minutes end. Thus introspection cannot detect a revoke.
- **Universe grants** (S5): `POST /oauth/v1/token/resources` returns the
  universe IDs that the user granted. A client can check a universe before it
  calls an operation. S5 does not say what a resource server returns when the
  universe is not in the grant.
- **`WWW-Authenticate`**: no Roblox source mentions this header.

| Case                                | Status                  | Body code                                                                      | `WWW-Authenticate` | Source                      |
| ----------------------------------- | ----------------------- | ------------------------------------------------------------------------------ | ------------------ | --------------------------- |
| Expired token                       | unknown (401 is likely) | unknown (gateway `errors[]` shape is likely)                                   | unknown            | live probe                  |
| Revoked token                       | unknown                 | unknown                                                                        | unknown            | live probe                  |
| Token without the scope             | 403 is documented       | `INSUFFICIENT_SCOPE` (v1) or `PERMISSION_DENIED` (v2), not confirmed for OAuth | unknown            | S4, live probe              |
| Universe not in the grant           | unknown (403 or 404)    | unknown                                                                        | unknown            | live probe                  |
| Bearer on an API-key-only operation | 401                     | unknown                                                                        | unknown            | S7, live probe for the body |

## Live-probe items

These feed the live-probe ticket (#682). Only a live call can settle them.

1. Expired access token on one v1 and one v2 operation: status, body,
   `WWW-Authenticate`.
2. Revoked authorization (revoke through `POST /oauth/v1/token/revoke`), then
   call with the old access token within its 15 minutes: status, body, header.
3. Token without the scope of the operation, on a v1, a v2 and a legacy
   operation: status, body code (`INSUFFICIENT_SCOPE` or `PERMISSION_DENIED`),
   header.
4. Token whose grant does not include the universe: status (403 or 404), body
   code, header.
5. Bearer on place publish, Luau execution and memory store: the full body and
   header of the 401 (S7 recorded only the status).
6. Whether an OAuth app can select the `legacy-*` scopes
   (`legacy-universe:manage`, `legacy-badge:manage`, `legacy-game-pass:manage`,
   `legacy-developer-product:manage`, `legacy-universe.badge:write`,
   `legacy-universe.badge:manage-and-spend-robux`) together with
   `game-pass:write`, `developer-product:write` and `universe:write` in one app
   category. Then one call per legacy group with that token.
7. Rate-limit bucket: the `x-ratelimit-*` headers on an OAuth call, before and
   after a token refresh, and next to an API-key call by the same user. This
   shows whether the bucket is per token, per authorization, or shared with the
   API key.
