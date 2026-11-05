---
"@bedrock-rbx/state-s3": patch
---

Keep state and lock writes fenced on S3-compatible stores that compress responses, such as Cloudflare R2. A compressed read returned a weak entity tag, so every following conditional write failed with a conflict.
