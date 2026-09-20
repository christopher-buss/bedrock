---
"@bedrock-rbx/ocale": patch
---

Accept the `MESSAGE_TYPE_UNSPECIFIED` log message type on Luau Execution task logs. Roblox's OpenAPI schema declares it, and the parser previously rejected the whole log page as a malformed response over a single message carrying it. The value is now passed through verbatim on `LogMessage.messageType`.
