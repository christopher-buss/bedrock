---
"@bedrock-rbx/core": patch
---

The live check reads the **Experience icon** off the universe's start place and each **Place icon** off its place. An icon changed or removed outside bedrock shows as an out-of-band `icon` edit in the diff preview, and the next deploy sets the recorded image again without an upload or a place publish. An icon the credential cannot read is left unchecked, and the deploy goes on.
