---
"@bedrock-rbx/ocale": patch
---

Stop rate limiting from delaying every request to an operation slower than one per second

The client's token bucket computed its burst capacity as `maxPerSecond * intervalMs`, whose units cancel to a constant. Any operation with a limit below one request per second could never accumulate a whole token, so every call slept — including the first call in a fresh process and calls made after an arbitrarily long idle period.

Creating a Luau execution binary input paid roughly 11 seconds per call against an endpoint that answers in about 140 ms. Publishing or saving a place paid 1 second, listing execution logs 333 ms, and submitting an execution task 500 ms.

Those four operations now grant the burst the schema documents (5, 30, 45 and 40 per minute respectively) before pacing begins, so an idle client sends immediately. Sustained pacing once the burst is spent is unchanged, as is every operation already at or above one request per second.
