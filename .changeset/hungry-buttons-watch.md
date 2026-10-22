---
"@bedrock-rbx/ocale": minor
"@bedrock-rbx/core": minor
"@bedrock-rbx/state-s3": minor
---

Remove the `apiKey` client and request option. Pass `credential: { kind: "apiKey", apiKey }` instead; `credential` is now required on client options. Custom transports read `RequestConfig.credential`, which replaces `RequestConfig.apiKey`.
