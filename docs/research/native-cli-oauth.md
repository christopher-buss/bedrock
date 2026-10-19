# Research: native CLI OAuth (L3) for bedrock

**Date:** 2026-10-19 **Ticket:** #685 (map #680)

## Question

What would it take for bedrock itself to run the Roblox OAuth 2.0 login, refresh
and token storage (L3), and how does that compare with "the caller owns the
token" (L1: ocale, L2: core)? This note lists options and trade-offs. It does
not pick one.

No live API calls were made. Every Roblox fact below comes from Roblox's public
docs; facts the docs do not state are marked **unverified**.

## Verified facts

### Roblox OAuth 2.0

| Fact                                                                                                                                 | Status                 | Source                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access token valid 15 minutes                                                                                                        | verified               | [oauth2-reference][ref]: "Is valid for 15 minutes."                                                                                                                                       |
| Refresh token valid 90 days                                                                                                          | verified               | [oauth2-reference][ref]: "Is valid for 90 days."                                                                                                                                          |
| Refresh token single-use; each refresh returns a new set                                                                             | verified               | [oauth2-reference][ref]: "Can only be used once before it expires to refresh tokens."                                                                                                     |
| Authorization code expires after 1 minute, single-use                                                                                | verified               | [oauth2-reference][ref]                                                                                                                                                                   |
| Grants: authorization code (+ PKCE) and refresh only                                                                                 | verified (by omission) | [oauth2-overview][ovw] documents only the authorization code flow and PKCE. No `client_credentials` grant is documented anywhere in the OAuth pages.                                      |
| Public client (PKCE, no secret) allowed for the login                                                                                | verified               | [oauth2-develop][dev]: PKCE is recommended "for all clients and require[d] … for public clients"; the token request carries "the code verifier value (PKCE) or client secret (non-PKCE)". |
| Public client can **refresh** without a secret                                                                                       | **unverified**         | The refresh request in [oauth2-reference][ref] lists `client_secret`; no page says whether a PKCE-only client may omit it on refresh.                                                     |
| One authorization per (user, app); new authorize replaces it                                                                         | **unverified**         | Not in any OAuth doc page. It is a starting fact on map #680, observed in use.                                                                                                            |
| Does a rotated refresh token get a fresh 90 days, or is there an absolute session cap?                                               | **unverified**         | Not stated.                                                                                                                                                                               |
| Unreviewed app: private mode, 10 unique users                                                                                        | verified               | [oauth2-registration][reg]: "it remains in private mode with a limit of 10 unique users."                                                                                                 |
| Review: demo video ≤ 1 min, no scopes for future features, public mode is one-way                                                    | verified               | [oauth2-registration][reg]                                                                                                                                                                |
| Scopes must fit one app category                                                                                                     | verified               | [oauth2-registration][reg]: "The set of scopes for an app must fall under a single app category".                                                                                         |
| `game-pass:write`, `developer-product:write`, `universe:write`, `universe.place:write` are in **Creation & Productivity Tools** only | verified               | [Creator Third Party App Policy][pol], "App Categories and Scope Details" (change log to 2026-10-08).                                                                                     |
| Redirect URLs: HTTPS, `localhost` over HTTP/HTTPS, or custom scheme; max 10 URLs, 256 chars                                          | verified               | [oauth2-registration][reg]. The page shows `http://localhost:80`; it does not say if the port must match exactly, or if `127.0.0.1` is accepted.                                          |
| Client secret is shown once; only regeneration after                                                                                 | verified               | [oauth2-registration][reg]                                                                                                                                                                |
| Revoke endpoint takes a refresh token                                                                                                | verified               | [oauth2-reference][ref]: `POST v1/token/revoke`                                                                                                                                           |

Endpoint coverage (from map #680 Notes, vendored schema): game passes, developer
products, universe and place get/patch, restarts accept OAuth. **Place publish,
Luau execution and memory store are API-key only.** Any deploy that publishes a
place needs an API key whatever L3 does.

### Standards

- RFC 8252 §6: public native clients MUST use PKCE. §7.3: the server MUST accept
  any port on a loopback IP redirect. §8.5: a secret shipped in a distributed
  app "should not be treated as confidential". ([RFC 8252][8252])
- RFC 7636 §4.2: `S256` code challenge. Roblox uses `S256`. ([RFC 7636][7636],
  [oauth2-reference][ref])
- RFC 9700 §2.2.2: refresh tokens of public clients MUST be sender-constrained
  or rotated. Roblox rotates. ([RFC 9700][9700])

Roblox documents only `localhost` (a name), not loopback IP literals. If ports
are matched exactly, a CLI must listen on one fixed, registered port (as
`wrangler login` does by default), and login fails when that port is busy.

### How comparable CLIs store tokens

| CLI      | Laptop store                                                                         | CI guidance                                                                                      | Source         |
| -------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | -------------- |
| gh       | OS credential store; plaintext file fallback; `--insecure-storage`                   | `GH_TOKEN` env var for "headless use"                                                            | [gh][gh]       |
| wrangler | Plaintext TOML by default; `--use-keyring` for OS keychain; fixed callback port 8976 | API tokens in CI; env tokens "take priority over any stored OAuth credentials"                   | [wrangler][wr] |
| gcloud   | Files in the gcloud config dir                                                       | Do not "use gcloud auth login for automated workloads on remote systems with persistent storage" | [gcloud][gc]   |

All three use the interactive OAuth login on laptops only, and point CI at a
non-interactive credential (an env token, an API token, a workload identity).
None writes a rotated user token back into CI.

### bedrock constraints

- Root `CLAUDE.md`, "No secrets in state": state holds resource IDs only. So
  neither the Gist backend nor `packages/state-s3` may hold the refresh token.
- [ADR-007](../adr/007-open-cloud-only.md) rejects OAuth as the primary method:
  API keys fit CI and the service-account pattern. An L3 ADR must amend this.
- [ADR-028](../adr/028-deploy-actions-per-user-github-app-auth.md): the deploy
  action uses a **per-user GitHub App**, and rejects a shared hosted App. The
  same reasoning applies to a shared Roblox OAuth app holding a secret.
- [ADR-031](../adr/031-state-concurrency-model.md): the state lock is per
  **Environment**. A refresh token is per (user, app), so two Environments
  deployed in parallel with one OAuth identity race on one single-use refresh
  token. The state lock does not cover this.
- `packages/actions/deploy/action.yaml` passes `BEDROCK_API_KEY` and
  `BEDROCK_GITHUB_TOKEN` as env vars. GitHub's `GITHUB_TOKEN` has no `secrets`
  permission ([workflow syntax][wfs]); writing a repo secret needs a token with
  the GitHub App "Secrets: write" permission or classic `repo` scope, and a
  libsodium-encrypted value ([secrets API][sec], [App permissions][perm]).

## Answers to the ticket bullets

### Login: public client or per-user app?

A public client is allowed for the login: PKCE plus `client_id`, no secret.
Whether a public client can also **refresh** without the secret is not
documented. If it cannot, a shared app is unusable (the secret cannot be
distributed, RFC 8252 §8.5), and only per-user apps work.

- **Shared bedrock app.** One `client_id` baked into bedrock. Needs review to
  pass 10 users, under the Creation & Productivity Tools category. Review wants
  a demo video and refuses scopes "for planned or future functionality", so the
  scope set is fixed at review time. The app owner (the maintainer) becomes the
  party Roblox holds to the Third Party App Terms and data-use rules for every
  user.
- **Per-user app.** Each user registers an app in private mode (10 users is
  enough for one team), picks the category, and gives bedrock `client_id` (and
  secret, if refresh needs it). No review. Setup cost moves to the user: about
  the same as creating an API key, plus a redirect URL to register.

### Refresh: where does the rotated token go?

Every refresh consumes the old token. The new one must be saved **before** the
deploy can fail, or the identity is lost and the user must log in again.

| Where  | Option                                                             | Trade-off                                                                                                                          |
| ------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Laptop | OS keyring (Windows Credential Manager, macOS Keychain, libsecret) | Secure; needs a native binding or a shell-out per OS. Must live in core, not ocale (ADR-008: ocale has zero runtime dependencies). |
| Laptop | File in the user config dir, mode 0600                             | Simple; plaintext at rest. gh and wrangler both keep it as a fallback or default.                                                  |
| CI     | Write back to a GitHub secret after each run                       | Needs a GitHub App with Secrets: write (extends the ADR-028 App), libsodium encryption, and a race guard between parallel jobs.    |
| CI     | External store (a separate S3 object or secret manager)            | Not the state object, so "no secrets in state" holds; adds a store to run and secure, against the zero-service stance.             |
| CI     | Do not use OAuth in CI: API key only                               | What gh, wrangler and gcloud advise. Place publish needs an API key anyway.                                                        |

If the one-authorization-per-(user, app) fact holds, a laptop login **replaces**
the CI authorization for the same user and app, and the next CI run fails. CI
would then need its own Roblox account or its own app.

### Lifetime

- **Deploy longer than 15 minutes.** The access token expires mid-deploy. The
  client must refresh in-process and swap the bearer for queued requests. The
  rate-limit queue and budget gate are keyed on the raw `apiKey` today
  (`packages/open-cloud/src/internal/resource-client.ts`); with rotating tokens
  that key changes every 15 minutes and splits the queue. The key must become a
  stable **Credential identity** (for example user id + client id), not the
  token. This is also needed for L1/L2 if the caller hands in a refreshing token
  source.
- **90 days of no use.** The refresh token expires and the user must log in
  again in a browser. On CI this means a human step. A scheduled keep-alive job
  could rotate it, but only if a rotated token gets a fresh 90 days
  (unverified).

### App review and a shared bedrock app

- Unreviewed: 10 unique users in total across all bedrock users. Not viable for
  a shared app beyond one team.
- Reviewed: write scopes need Creation & Productivity Tools. Those scopes
  (`game-pass:write`, `developer-product:write`, `universe:write`,
  `universe.place:write`) are in that category, so review is possible in
  principle; approval is at Roblox's discretion and public mode is one-way.
- Any new scope later (a new resource kind) needs a new review and fresh consent
  from every user.

## Options

| #   | Option                                                                                                                                                               | Effort      | Risk   | Notes                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | **Caller owns the token (L1/L2 only).** ocale/core accept a bearer or a token-source callback; no login.                                                             | Low         | Low    | Baseline. Rotation and storage stay with the caller. Still needs the stable Credential identity key and an early clear failure for API-key-only endpoints.                            |
| B   | **A + refresh helper.** bedrock takes a refresh token + client id (+ secret) and refreshes in-process; a `TokenStore` port receives each rotated token. No login UI. | Medium      | Medium | Solves the 15-minute limit inside bedrock. Storage stays the caller's choice. New port; loss-on-crash risk if the store write fails after a refresh.                                  |
| C   | **B + `bedrock login`, per-user app.** PKCE + localhost listener; laptop store in keyring or file.                                                                   | Medium–High | Medium | No review, no shared liability. Per-OS keyring work in core. Fixed redirect port if Roblox matches ports exactly. CI still needs A or an API key.                                     |
| D   | **C with a shared, reviewed bedrock app.** `client_id` built in.                                                                                                     | High        | High   | Best UX. Depends on public-client refresh without a secret (unverified), a passed review, and the maintainer owning policy compliance for all users. Scope set frozen at review.      |
| E   | **C or D + CI write-back.** Rotated token written to a GitHub secret by the deploy action.                                                                           | High        | High   | Parallel jobs race on one single-use token; a lost write locks CI out until a human logs in. Laptop login may revoke CI's authorization (unverified fact). No surveyed CLI does this. |

Effort and risk compared with A: B adds one port and in-process refresh. C adds
a login UX, a listener, and per-OS storage. D adds an external review and a
policy relationship that bedrock cannot control. E adds a cross-system write on
every run with a failure mode that needs a human to fix.

## Open questions (need a live test or Roblox confirmation)

1. Can a PKCE public client refresh without `client_secret`?
2. Does a new authorize revoke the previous refresh token for the same (user,
   app)?
3. Does each rotated refresh token get a fresh 90 days?
4. Does Roblox match the redirect port exactly, and is `127.0.0.1` accepted?

## Sources

- [Roblox OAuth 2.0 overview][ovw]
- [Roblox OAuth 2.0 reference][ref]
- [Roblox OAuth 2.0 registration and review][reg]
- [Roblox OAuth 2.0 develop guide][dev]
- [Roblox Creator Third Party App Policy][pol]
- [RFC 7636 PKCE][7636], [RFC 8252 OAuth for Native Apps][8252], [RFC 9700 OAuth
  Security BCP][9700]
- [gh auth login][gh], [wrangler login][wr], [gcloud authorizing][gc]
- [GitHub Actions secrets API][sec], [GitHub App permissions][perm], [workflow
  `permissions`][wfs]

[ovw]: https://create.roblox.com/docs/cloud/auth/oauth2-overview
[ref]: https://create.roblox.com/docs/cloud/auth/oauth2-reference
[reg]: https://create.roblox.com/docs/cloud/auth/oauth2-registration
[dev]: https://create.roblox.com/docs/cloud/auth/oauth2-develop
[pol]:
	https://en.help.roblox.com/hc/en-us/articles/37924211313044-Creator-Third-Party-App-Policy
[7636]: https://www.rfc-editor.org/rfc/rfc7636
[8252]: https://www.rfc-editor.org/rfc/rfc8252
[9700]: https://www.rfc-editor.org/rfc/rfc9700
[gh]: https://cli.github.com/manual/gh_auth_login
[wr]: https://developers.cloudflare.com/workers/wrangler/commands/general/
[gc]: https://docs.cloud.google.com/sdk/docs/authorizing
[sec]: https://docs.github.com/en/rest/actions/secrets
[perm]:
	https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps
[wfs]:
	https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
