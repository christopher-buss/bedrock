---
"@bedrock-rbx/core": patch
"@bedrock-rbx/ocale": patch
---

Enrich API errors with request context and summarize gateway error pages.
`ApiError` now carries the request `method`, `url`, `elapsedMs`, and an
allowlisted set of `responseHeaders` (server/edge/request-id headers useful for
escalation), and an HTML load-balancer error page is captured as a short
`gatewaySummary` rather than retained whole. Deploy failure messages render this
context on one line — `on METHOD url after Ns`, a gateway summary in place of a
raw HTML dump, and any captured headers — and no longer re-dump a response body
whose message already appears in the status line.
