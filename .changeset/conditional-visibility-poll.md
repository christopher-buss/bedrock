---
"@bedrock-rbx/core": patch
---

Cut the gist state adapter's GitHub API usage on writes. After a state write, the read-your-write visibility poll now issues conditional GETs (`If-None-Match`) once a stale replica reveals its ETag: a replica still serving the prior body answers `304 Not Modified`, which GitHub does not count against the primary REST rate limit. A slow-to-propagate write now costs roughly one charged GET instead of one per poll attempt, lowering the chance of a `403` rate-limit exhaustion under frequent deploys.
