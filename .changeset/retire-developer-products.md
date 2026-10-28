---
"@bedrock-rbx/core": patch
"@bedrock-rbx/ocale": patch
"@bedrock-rbx/state-s3": patch
---

Support `retired: true` for developer products: rename them with Mantle's UTC deprecated name, clear the description, take them off sale, and replace the recorded icon with the placeholder before dropping state. Failed retirement retains state for retry. Icon-removal errors now point to explicit retirement.
