# Bedrock GitHub Actions

Drop-in GitHub Actions for deploying a Roblox project with
[Bedrock](https://github.com/christopher-buss/bedrock) and committing the
regenerated codegen (asset ids) back to your repository.

Two actions are published from this directory:

| Action | Path | Use |
| --- | --- | --- |
| **Deploy** | `christopher-buss/bedrock/packages/actions/deploy@actions-v1` | Full pipeline: deploy → mint token → reflow codegen. |
| **Commit-back** | `christopher-buss/bedrock/packages/actions@actions-v1` | Just the race-safe codegen reflow, to compose yourself. |

Both are built from public primitives, so you can wire your own pipeline if the
drop-ins don't fit.

## Why a token (and a bot)?

A deploy that runs codegen rewrites your asset-id files. Those regenerated files
must be committed back to your deploy branch — usually a protected `main`. The
workflow's built-in `GITHUB_TOKEN` cannot push to a protected branch, so the
push needs a **write-capable token from an identity allowed to bypass branch
protection**. The recommended identity is a per-repository **GitHub App** you
create and own (see [Set up the deploy bot](#set-up-the-deploy-bot)). A
fine-grained PAT also works but is tied to a person and expires.

> There is no shared "Bedrock bot" to install. A GitHub App authenticates with a
> private key, which can never be safely shared — so you create your own.

## Quick start — deploy composite

The `app-client-id` / `app-private-key` inputs mint the commit-back token from
your GitHub App (see [Set up the deploy bot](#set-up-the-deploy-bot)):

```yaml
- uses: actions/checkout@v5

# ...build your place artifact / project here...

- uses: christopher-buss/bedrock/packages/actions/deploy@actions-v1
  with:
    api-key: ${{ secrets.BEDROCK_API_KEY }}
    app-client-id: ${{ secrets.DEPLOY_APP_CLIENT_ID }}
    app-private-key: ${{ secrets.DEPLOY_APP_PRIVATE_KEY }}
    environment: production
    gist-token: ${{ secrets.BEDROCK_GIST_TOKEN }}
    paths: src/shared/assets
```

`paths` is your Bedrock `codegen.output` directory — the action reflows only the
files that changed under it. Set `deploy-command` if you invoke the CLI
differently (defaults to `npx bedrock`; use `bun x bedrock` on Bun).

If you already have a write token, pass `commit-token:` instead of the
`app-*` inputs. With neither, the commit-back step is skipped.

## Commit-back primitive

Run the reflow on its own, after your own deploy step:

```yaml
- uses: christopher-buss/bedrock/packages/actions@actions-v1
  with:
    branch: main
    paths: src/shared/assets
    token: ${{ steps.app-token.outputs.token }}
```

It snapshots the changed files, resets onto the latest branch tip, restores only
those files (codegen ids win — never a merge), commits, and pushes — retrying if
the tip moves under a concurrent push. The default `message` carries `[skip ci]`
to avoid a redeploy loop; override `message` to change that.

| Input | Default | |
| --- | --- | --- |
| `token` | — (required) | Write-capable token the push authenticates with. |
| `paths` | — (required) | Whitespace-separated paths to reflow. |
| `branch` | `main` | Branch to commit onto. |
| `message` | `chore(assets): regenerate asset ids [skip ci]` | Commit message. |
| `author-name` | `github-actions[bot]` | Commit author name. |
| `author-email` | `41898282+github-actions[bot]@users.noreply.github.com` | Commit author email. |
| `max-attempts` | `3` | Push attempts before giving up on a moving tip. |

Outputs: `committed` (`true`/`false`), `changed-files` (count), `sha` (new
commit, empty on a no-op).

## Set up the deploy bot

Create a GitHub App you own, install it on your repository, and store its
credentials as secrets.

1. **Create the app.** Go to **Settings → Developer settings → GitHub Apps → New
   GitHub App** (use your organization's settings for an org repo). Set:
   - **GitHub App name**: anything, e.g. `<your-project> deploy bot`.
   - **Homepage URL**: your repository URL.
   - **Webhook**: uncheck **Active** — no webhook is needed.
   - **Repository permissions → Contents**: **Read and write**.
   - Leave every other permission as **No access**.
   - **Where can this app be installed?**: **Only on this account**.
2. **Generate a private key.** On the app's page, under **Private keys**,
   click **Generate a private key** and keep the downloaded `.pem`.
3. **Install the app** on the repository you deploy from (the app page →
   **Install App**).
4. **Add repository secrets** (Settings → Secrets and variables → Actions):
   - `DEPLOY_APP_CLIENT_ID` — the app's **Client ID**.
   - `DEPLOY_APP_PRIVATE_KEY` — the full contents of the `.pem`.
5. **Allow the app to push to the protected branch.** In your branch protection
   rule (or ruleset) for `main`, add the app to the **bypass list** for the
   "require a pull request" / "restrict who can push" rules.

The deploy composite mints a short-lived installation token from these secrets
at run time via
[`actions/create-github-app-token`](https://github.com/actions/create-github-app-token)
— nothing is hosted, and the token expires in about an hour.

### Manifest reference

The same settings as a [GitHub App
manifest](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)
(`deploy-app.manifest.json`), if you prefer the manifest flow over filling the
form by hand:

```json
{
	"name": "Bedrock deploy bot",
	"url": "https://github.com/christopher-buss/bedrock",
	"public": false,
	"default_permissions": { "contents": "write" },
	"default_events": []
}
```
