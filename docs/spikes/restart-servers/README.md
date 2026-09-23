# Server restart endpoints spike

Live capture for
[christopher-buss/bedrock#235](https://github.com/christopher-buss/bedrock/issues/235),
taken before any client code was written against the restart operations.

## Question

The vendored OpenAPI lists two ways to restart a universe's servers and two
companion reads:

| Operation                      | Route                                                        | Stability |
| ------------------------------ | ------------------------------------------------------------ | --------- |
| `Cloud_RestartUniverseServers` | `POST /cloud/v2/universes/{id}:restartServers`               | STABLE    |
| `Restarts_LaunchRestart`       | `POST /server-management/v1/universes/{id}/restarts`         | BETA      |
| `Restarts_ListRestartStatuses` | `GET /server-management/v1/universes/{id}/restarts`          | BETA      |
| `Restarts_ForecastRestart`     | `GET /server-management/v1/universes/{id}/restarts:forecast` | BETA      |

The spike checks the real success and error bodies, the enforced body rules,
whether the two launch paths are one mechanism, and the live rate-limit headers.

## Method

One probe script,
[probe-restart-servers.ts](../../../packages/open-cloud/scripts/probe-restart-servers.ts),
in two modes:

```bash
ROBLOX_API_KEY=<key> ROBLOX_TEST_UNIVERSE_ID=<id> bun packages/open-cloud/scripts/probe-restart-servers.ts
PROBE_MODE=live ROBLOX_API_KEY=<key> ROBLOX_TEST_UNIVERSE_ID=<id> bun packages/open-cloud/scripts/probe-restart-servers.ts
```

The default mode needs an empty universe and skips every mutation when the
forecast fails or shows a player. Live mode needs one player in a live server.
It ends with a real restart, which moves that player to a new server.
`PROBE_LIVE_VIA=cloud-v2` sends that final restart through `:restartServers`.

## Findings

Captured on 2026-09-23 against universe `5202621917`, root place `15098004467`
(version 6). The empty-universe mode ran three times. Live mode ran once through
each launch path, with one player in one server.

### One key reaches all four operations

The key with `universe:read` and `universe:write` got a 2xx from every
operation. An invalid key gets the gateway envelope from both families:

```json
{ "errors": [{ "code": 0, "message": "Invalid API Key" }] }
```

### Both launch paths are one mechanism

A `:restartServers` call that selected a live server showed up in the
server-management list with its own restart id. The cloud v2 response is `{}`,
so the caller does not get that id back. Only `launch` returns it.

### Launch returns a nil id when no server matches

```json
{
	"id": "00000000-0000-0000-0000-000000000000",
	"playersImpacted": 0,
	"instancesImpacted": 0
}
```

No restart is recorded, and the list stays empty. With a live server:

```json
{
	"id": "89310e32-489a-4a8f-bf28-083b7d7718bd",
	"playersImpacted": 1,
	"instancesImpacted": 1
}
```

### Restart status shape

```json
{
	"restartStatuses": {
		"e959da49-68c0-440a-ba43-0326468d314e": {
			"universeId": "5202621917",
			"scheduledTime": "2026-09-23T17:21:39.2972534Z",
			"startTime": "2026-09-23T17:22:39.2972534Z",
			"placeRestartStatuses": {
				"15098004467": {
					"state": "RESTARTING",
					"startTime": "2026-09-23T17:21:39.2972534Z",
					"endTime": null,
					"totalPlayers": 1,
					"totalInstances": 1,
					"remainingPlayers": 0,
					"remainingInstances": 0,
					"filter": { "versions": [6], "excludeCurrentVersion": null },
					"latestVersion": "6"
				}
			}
		}
	}
}
```

- The live runs showed all three `RestartState` values: `DELAYING` for the
  bleed-off minute, `RESTARTING` briefly, then `SUCCEEDED` 5 to 8 seconds after
  the bleed-off.
- `endTime` is `null` until the restart ends. `excludeCurrentVersion` is `null`
  when `versions` is set.
- Timestamps carry seven fractional digits (.NET ticks).
- A launch with no `places` records the filter as the versions it selected
  (`{ "versions": [6] }`), not as "all".
- `universeId` and `latestVersion` are strings. `versions` entries are numbers.

### Forecast shape

```json
{
	"placeForecasts": {
		"15098004467": {
			"playersImpacted": 0,
			"totalPlayers": 1,
			"instancesImpacted": 0,
			"totalInstances": 1,
			"latestPlaceVersion": "6",
			"publishTime": "2026-04-24T02:36:28.673Z",
			"isNotInUniverse": false,
			"playersPerVersion": { "6": 1 },
			"instancesPerVersion": { "6": 1 }
		}
	}
}
```

An empty universe returns `{ "placeForecasts": {} }`. The forecast takes no
parameters. The `*Impacted` counts were 0 while the one live server ran the
latest version, so they appear to count only servers on older versions. One
capture cannot confirm this.

### "Old versions only" on an empty place returns 500

Both paths return 500 when the request asks for old versions of one named place
and that place has no running server:

| Request                                                       | Empty place | Live place |
| ------------------------------------------------------------- | ----------- | ---------- |
| `:restartServers` `{ placeIds: [p] }` (default old-only)      | 500         | 200        |
| `:restartServers` `{ placeIds: [p], closeAllVersions: true }` | 200         | 200        |
| launch `{ places: { p: { excludeCurrentVersion: true } } }`   | 500         | 200        |

The 500 happened on every attempt, so it looks like a server defect and not a
transient error. A retry cannot help.

### Body rules the server enforces

| Rule                                                          | Result                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------ |
| cloud v2 `bleedOffDurationMinutes` outside 1-60, bleed-off on | 400 `INVALID_ARGUMENT`                                       |
| cloud v2 duration set with `bleedOffServers` off              | accepted, ignored                                            |
| cloud v2 place outside the universe                           | 404 `NOT_FOUND`                                              |
| cloud v2 `placeIds` as strings or numbers                     | both accepted                                                |
| launch `bleedOffDurationMinutes` outside 1-240                | 400 ProblemDetails                                           |
| launch place outside the universe                             | 400 `{ "error": "Place 1 does not belong to universe ..." }` |
| launch `attributes` not an object, or over 500 bytes          | 400 `{ "error": "..." }`                                     |
| launch `versions` together with `excludeCurrentVersion`       | accepted (not enforced)                                      |
| launch unknown body key                                       | accepted, ignored                                            |
| launch with no body                                           | 415; `{}` is required                                        |

### Three error envelopes

- Cloud v2: `{ "code": "INVALID_ARGUMENT", "message": "..." }`.
- Server-management rule errors: `{ "error": "<sentence>" }`.
- Server-management model binding: ASP.NET ProblemDetails with `title`,
  `status`, `errors: { Field: [message] }`, `traceId`.

`extractErrorCode` reads none of these as intended. It does not read a top-level
`code`, and it takes the `error` sentence as a code. That fix is separate work,
not part of this issue.

### Rate limits match the schema

| Operation      | `x-ratelimit-limit` | Schema `maxInPeriod` |
| -------------- | ------------------- | -------------------- |
| restartServers | 30                  | 30                   |
| launch         | 100                 | 100                  |
| list           | 100                 | 100                  |
| forecast       | 100                 | 100                  |

Launch, list, and forecast each have a separate `remaining` counter. The header
also carries a shared `300;w=60` tier.
