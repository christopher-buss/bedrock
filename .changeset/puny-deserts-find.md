---
"@bedrock-rbx/core": patch
---

When the free badge quota cannot be read, a Deploy with spend approval and a `spendLimit` now continues if paying for every badge create fits the limit. Badge creates then run one at a time, each sent free first and paid only on a cost refusal. If paying for every create does not fit, the Deploy is refused before any operation and the refusal names the Robux needed. With `allowDeferredCreates`, creates the limit cannot pay for become Deferred creates.
