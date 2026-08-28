---
"@bedrock-rbx/state-s3": patch
---

Republish `@bedrock-rbx/state-s3` through npm's trusted publishing flow, so the tarball carries a provenance attestation tying it to the workflow run and the commit that built it. The 0.2.0 tarball was published by hand and carries none: a trusted publisher cannot be configured on npmjs.com until the package name exists, so the first release had nothing to exchange its OIDC token against. The plugin itself is unchanged.
