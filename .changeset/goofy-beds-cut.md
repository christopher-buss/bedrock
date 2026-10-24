---
"@bedrock-rbx/ocale": patch
---

Every `OpenCloudError` returned after a retry now carries `previousAttempts`: the earlier attempts' failures, oldest first, so a richer first failure is no longer lost when a later attempt fails differently.
