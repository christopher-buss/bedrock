---
"@bedrock-rbx/ocale": patch
---

Fix place uploads failing on Node 26. Node 26 negotiates HTTP/2 by default,
where the `connection: close` uploads rely on is a forbidden header that the
transport drops, and every upload shares one multiplexed session — so a single
session drop by Roblox's edge gateway failed every place in a deploy at once.
Uploads now pin HTTP/1.1, using the runtime's own dispatcher class so the
package stays dependency-free, and fall back to the default transport on any
runtime that offers no such dispatcher. The HTTP/2 spellings of a dead
connection (`ERR_HTTP2_STREAM_ERROR`, `ERR_HTTP2_SESSION_ERROR`,
`UND_ERR_INFO`) also join the retryable transport codes.
