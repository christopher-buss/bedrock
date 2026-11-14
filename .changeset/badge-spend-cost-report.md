---
"@bedrock-rbx/core": patch
---

Show the Robux cost of badge creates beyond the free badge quota. In an Environment with a `spendLimit`, `bedrock diff` reports the paid creates, the price, the total, and the limit; `bedrock diff --allow-spend` previews the Deploy as run with spend approval. A Deploy without spend approval that is refused or defers badge creates names the Robux needed and that `--allow-spend` pays. The refusal, the `badgeCreatesDeferred` event, and the diff preview carry the figures as `spendQuote`.
