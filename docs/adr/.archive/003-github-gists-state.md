# ADR-003: GitHub Gists for State Storage

**Date:** 2025-12-06 **Status:** Accepted

## Context

Deployment tools need to track state: what resources exist, their IDs, and their
current configuration. This enables:

- Detecting what changed between deployments
- Updating existing resources instead of creating duplicates
- Knowing when resources were removed from config

Mantle uses Amazon S3 for remote state storage. While effective, S3 requires:

- AWS account setup
- IAM credentials configuration
- Bucket creation and permissions
- Environment variable management

This creates friction for new users, especially those unfamiliar with AWS.

## Decision

Bedrock will use **GitHub Gists** as the default state storage backend, with the
architecture supporting additional backends in the future (S3, Cloudflare R2).

## Consequences

### Positive

- **Zero external service**: Uses GitHub, which users already have
- **Works with GITHUB_TOKEN**: CI/CD integration is automatic
- **Version history**: Gists track revision history
- **Easy debugging**: View state directly in browser
- **Simple setup**: `bedrock init` creates the gist automatically

### Negative

- **1MB file limit**: Large state files may hit the limit
- **"Secret" gists aren't private**: Anyone with the URL can view
- **GitHub dependency**: Requires GitHub account

### Mitigations

- **Size**: 1MB is sufficient for most deployments (state is just resource IDs)
- **Security**: State contains only public Roblox resource IDs, not secrets
- **Alternatives**: Architecture supports adding S3, R2 backends later

## State Contents

The state file contains only resource mappings:

```json
{
	"experience": { "id": "123456789" },
	"passes": {
		"vip-pass": { "id": "111222333", "lastUpdated": "2025-12-06" }
	}
}
```

**Not stored in state:**

- API keys (environment variables)
- ROBLOSECURITY tokens (not used)
- Any secrets

## Alternatives Considered

### Amazon S3 (like Mantle)

Industry standard for remote state.

**Rejected as default because:**

- Requires AWS account and IAM setup
- High barrier to entry for new users
- Will be available as an optional backend

### Git Orphan Branches

Store state in a dedicated branch of the repository.

**Rejected because:**

- Terraform explicitly discourages git-based state
- Risk of secrets in git history
- Merge conflict potential

### Roblox DataStores

Store state in Roblox's own storage.

**Rejected because:**

- Couples CLI state to Roblox
- Requires game to exist first (chicken-egg problem)
- Not designed for this use case

### Cloudflare R2

S3-compatible with simpler setup.

**Rejected as default because:**

- Still requires external account setup
- Will be available as an optional backend

## Future Work

- Add S3 backend for teams with existing AWS infrastructure
- Add Cloudflare R2 backend as simpler alternative to S3
- Define plugin interface for custom backends

## References

- [GitHub Gists API](https://docs.github.com/en/rest/gists/gists)
- [Using Gists as a Database](https://dev.to/rikurouvila/how-to-use-a-github-gist-as-a-free-database-20np)
