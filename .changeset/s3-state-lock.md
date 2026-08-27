---
"@bedrock-rbx/state-s3": patch
---

Lock the environment a deploy is reconciling, so two CI jobs pointed at one environment are serialized instead of both creating resources on Roblox. The hold is a conditional create of `<prefix>/locks/<environment>.json`, under its own prefix segment so a bucket lifecycle rule can expire abandoned ones without touching state, and its record carries who took it, what for, and when. A run that finds the environment held retries with exponential backoff for five minutes by default; the new `lockTimeoutMs` state key changes that bound, and `0` refuses immediately. Each wait is reported through the **Progress port**, and giving up names who holds the environment and since when.

Retrying carries on through a record it could not read, which is the read contention itself breaks: an unreadable holder still retries, and a holder that releases mid-wait ends in acquisition. A credential that is *refused* the record ends the wait at once instead, so a missing `s3:GetObject` is reported as itself rather than as five minutes of contention. A record found in the way is compared against the acquiring run's own identity first, so a conditional create that landed and was reported as refused is not mistaken for someone else's hold, and a holder that a later round finds gone stops being named as the one in the way.

Release writes a tombstone conditionally over the exact bytes the hold was taken as; the lock object is never deleted, because conditional delete is not portable across S3-compatible stores. A store that answers the winning write without an entity tag is given no hold at all, since a hold with nothing to write the tombstone against could never be given up safely.

The run is recorded as `BEDROCK_LOCK_OWNER` when that is set, as the URL of the GitHub Actions run when `GITHUB_RUN_ID` is, and as the local user otherwise. `createS3StateLockPort` builds the port directly for a caller that wants one outside a deploy, and a hold that cannot be taken carries an `S3StateLockErrorDetail` payload naming the lock object, what went wrong, and on a timeout who held the environment and for how long.
