---
"@bedrock-rbx/core": patch
---

Name the failing call on two diagnostics that were reporting it blank. A permission failure now reads `HTTP 403 on developer-products.create (POST https://apis.roblox.com/… after 1.2s): missing required scope …`, with the method, url, and elapsed time ahead of the credentials link the reader acts on; a `PermissionError` is rendered by its own detail line, which listed the operation key and the scopes but never the request.

A 404 that becomes an adoption failure keeps that context too. Reporting a universe as not found replaced the API's error with Bedrock's own message and dropped the request along with it, so the one **Deploy** failure that names a config key could not name the call that produced it.
