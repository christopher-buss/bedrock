---
"@bedrock-rbx/ocale": patch
---

Fix intermittent place publish failures caused by HTTP keep-alive connection
reuse. Roblox's edge gateway discards idle pooled connections faster than a
pooling `fetch` expects, and a publish written into a discarded connection never
reaches Open Cloud — surfacing as a gateway error page or a socket reset, having
created no version. `publish` and `save` now send `connection: close`, and retry
failures that provably never reached Open Cloud (transient transport errors and
gateway-served responses). They still do not retry 5xx, where the duplicate-write
risk actually lies.
