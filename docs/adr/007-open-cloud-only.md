# ADR-007: Open Cloud APIs Only

**Date:** 2025-12-13 **Status:** Accepted

## Context

Bedrock is an Infrastructure-as-Code deployment tool for Roblox, enabling teams
to manage game state (developer products, place files, configuration) via code
rather than manual processes. Primary use case: one-click CI/CD deployments
where merging to a branch triggers automated deployment.

Team of ~10 developers needs to deploy from CI/CD pipelines without complex
infrastructure setup.

Roblox provides three authentication methods:

1. **Open Cloud API Keys**: API key-based, granular permissions, service account
   pattern
2. **OAuth 2.0**: User-scoped authorization for third-party apps
3. **ROBLOSECURITY cookies**: Legacy session tokens, IP region-locked since
   March 2022

Current pain point: Mantle (tool being replaced) uses ROBLOSECURITY, which
requires VPN workaround due to region locking. Setup: service account → VPN
connection → get cookie → CI must connect to same VPN before deploying. Heavy,
fragile, costly.

**Constraints:**

- Zero external service costs required to deploy (deal-breaker)
- ASAP timeline for v0.1 MVP (single game migration from Mantle)
- Standard security practices (no plaintext secrets)
- Accept feature gaps for v0.1 (manage missing features manually)

## Decision

Bedrock will **exclusively use Roblox Open Cloud APIs** with API key
authentication. Features not available via Open Cloud will not be supported.

OAuth 2.0 reserved for future consideration if user-scoped authorization needed.
ROBLOSECURITY explicitly excluded.

## Consequences

### Positive

- **Zero infrastructure costs**: No VPN or external services required
- **CI/CD works out-of-the-box**: API keys designed for automated pipelines
- **Low barrier to entry**: Team members generate API key from service account,
  no VPN setup
- **Simple implementation**: Single authentication method (FCIS adapter layer)
- **Future-proof**: Aligned with Roblox's stated direction (actively expanding
  Open Cloud)
- **Secure**: API keys have granular permissions, scoped to specific
  operations/resources
- **No region locking**: Unlike ROBLOSECURITY, API keys work from any IP
- **Service account pattern**: Roblox recommending this over group-owned keys

### Negative

- **Feature gaps**: Some Mantle features unavailable until Roblox adds Open
  Cloud support
- **Manual workarounds**: Team must manage unsupported features in Roblox Studio
- **Dependency on Roblox**: Must wait for Roblox to expand Open Cloud coverage
- **Potential frustration**: If critical feature missing, could block workflows

### Mitigations

- **Reversible**: FCIS architecture allows adding ROBLOSECURITY adapter later if
  absolutely necessary
- **Accept trade-off**: v0.1 MVP scope limited to Open Cloud capabilities
- **Monitor expansions**: Roblox actively releasing new Open Cloud endpoints
  (developer products/game passes added 2024)
- **Document gaps**: Track missing features, update as Open Cloud expands

## Alternatives Considered

### Support Both (Open Cloud + ROBLOSECURITY)

Maximum compatibility with Mantle features.

**Rejected because:**

- User explicitly does not want ROBLOSECURITY allowed
- VPN requirement creates unacceptable cost and complexity
- Doubles authentication complexity (two adapters to maintain)
- ROBLOSECURITY being actively deprecated by Roblox
- Region locking makes it unreliable for CI/CD
- Security concerns with cookie-based authentication

### ROBLOSECURITY Only

Maximum feature parity with current Mantle.

**Rejected because:**

- VPN costs and setup complexity are deal-breakers
- Region locking breaks CI/CD without VPN workaround
- Not aligned with Roblox's direction (being phased out)
- Roblox made breaking changes to cookies in August 2024 with no stability
  guarantees
- High barrier to entry for team members

### OAuth 2.0 as Primary Method

Use OAuth 2.0 instead of API keys.

**Rejected because:**

- OAuth 2.0 designed for third-party apps requiring user authorization
- Bedrock is automation tool, not hosted app with user login
- API keys more appropriate for CI/CD and service account pattern
- Same endpoint coverage as API keys, so no advantage for this use case

## Implementation Notes

- Use API keys with service account (Roblox recommendation)
- Implement authentication as FCIS adapter (supports future auth method changes)
- Document Open Cloud coverage gaps in project docs
- Configure API key permissions to minimum required scopes

## Related Decisions

- Future: If OAuth 2.0 needed for user-facing features, can add OAuth adapter
- Future: Monitor Roblox announcements for new Open Cloud endpoints

## References

- [Roblox Open Cloud Documentation](https://create.roblox.com/docs/cloud)
- [Manage API Keys Documentation](https://create.roblox.com/docs/cloud/open-cloud/api-keys)
- [New Open Cloud APIs for Developer Products and Game Passes (2024)](https://devforum.roblox.com/t/new-open-cloud-apis-for-configuring-developer-products-and-game-passes/4114297)
- [Open Cloud Place Publishing API](https://devforum.roblox.com/t/open-cloud-publishing-your-places-with-api-keys-is-now-live/1485135)
- [IP Region Locking for ROBLOSECURITY (March 2022)](https://devforum.roblox.com/t/ip-changes-invalidate-cookie/1700515)
- [OAuth 2.0 General Availability (2024)](https://devforum.roblox.com/t/announcing-general-availability-of-open-cloud-oauth-20/2622212)
