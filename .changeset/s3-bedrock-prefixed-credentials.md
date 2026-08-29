---
"@bedrock-rbx/state-s3": patch
---

Read `BEDROCK_S3_ACCESS_KEY_ID`, `BEDROCK_S3_SECRET_ACCESS_KEY`, and `BEDROCK_S3_SESSION_TOKEN` ahead of their `AWS_` counterparts, so a machine whose AWS variables already point at another account can send bedrock somewhere else. Each set is read as a whole credential: a half-written prefixed pair leaves the `AWS_` pair signing on its own, and a prefixed pair takes its session token from `BEDROCK_S3_SESSION_TOKEN` alone, so no signing mixes one account's key with another's secret.
