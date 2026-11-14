---
"@bedrock-rbx/core": patch
---

Pay for badge creates beyond the free badge quota. An Environment can set `spendLimit` (Robux), and a Deploy run with `allowSpend: true` pays the live badge creation price for the creates the free quota does not cover, as long as the total fits the limit. Every create is sent free first, so a free create is never paid for. A Deploy whose shortfall the limit cannot cover is refused before any operation, and the refusal names the Robux needed and the limit. The Deploy result carries `paidCreates` and `robuxSpent`.
