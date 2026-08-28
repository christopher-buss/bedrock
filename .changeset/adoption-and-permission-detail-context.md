---
"@bedrock-rbx/core": patch
---

Name the failing call on a permission failure. The line reads `HTTP 403 on developer-products.create (POST https://apis.roblox.com/... after 1.2s): missing required scope ...`, with the method, url, and elapsed time ahead of the credentials link. It also carries the response body, the gateway summary, and the escalation headers, which every other API failure already showed and this one alone left out.

Reporting a universe as not found says which call failed. The 404 was replaced with Bedrock's own adoption message and lost the request along with it, so the failure that names a config key could not name the call behind it. The API's error is now kept as the cause.
