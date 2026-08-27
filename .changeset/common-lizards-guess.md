---
"@bedrock-rbx/state-s3": patch
---

Migrate a Mantle project whose state has only ever lived in a bucket, with nothing to download first. `bedrock migrate` now offers this **Backend** as the place the previous tool's state is read from: it asks for Mantle's own `state.remote` block - the bucket, the region, the key it stored the state under, and the endpoint its custom-region form names for an S3-compatible store like Cloudflare R2 - and reads the object Mantle keyed `<project>.mantle-state.yml`, whether or not the answer already carries that suffix. Core still parses the Mantle format; this **Backend** only moves the bytes.

Migrating onto this **Backend** records what that block said instead of asking for the same bucket again, custom-region endpoint included, and the project name Mantle keyed its object by becomes the `prefix`, so two projects that shared one bucket under Mantle stay apart rather than both writing `production.json` at the root. A migration onto a bucket the state was not fetched from asks for the bucket, the region, and an endpoint that may be skipped. Credentials resolve exactly as they do for a **Deploy**.
