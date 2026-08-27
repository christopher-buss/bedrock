---
"@bedrock-rbx/state-s3": patch
---

Lock the environment a deploy is reconciling, so two CI jobs pointed at one environment are serialized instead of both creating resources on Roblox. The hold is a conditional create of `<prefix>/locks/<environment>.json`, under its own prefix segment so a bucket lifecycle rule can expire abandoned ones without touching state, and its record carries who took it, what for, and when. A run that finds the environment held retries with exponential backoff for five minutes by default; the new `lockTimeoutMs` state key changes that bound, and `0` refuses immediately. Each wait is reported through the **Progress port**, and giving up names who holds the environment and since when.

Retrying never depends on reading the current holder's record, which is exactly the read that fails under contention: an unreadable holder still retries, and a holder that releases mid-wait ends in acquisition. A record found in the way is compared against the acquiring run's own identity first, so a conditional create that landed and was reported as refused is not mistaken for someone else's hold. Release writes a tombstone conditionally over the exact bytes the hold was taken as; the lock object is never deleted, because conditional delete is not portable across S3-compatible stores.

The run is recorded as `BEDROCK_LOCK_OWNER` when that is set, as the URL of the GitHub Actions run when `GITHUB_RUN_ID` is, and as the local user otherwise. `createS3StateLockPort` builds the port directly for a caller that wants one outside a deploy, and a hold that cannot be taken carries an `S3StateLockErrorDetail` payload naming the lock object, what went wrong, and on a timeout who held the environment and for how long.
