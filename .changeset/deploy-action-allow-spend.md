---
"@bedrock-rbx/actions": patch
---

Add an `allow-spend` input to the deploy action. When it is `true`, the action passes `--allow-spend` to `bedrock deploy`, so badge creates past the free daily quota are paid for up to the environment's `spendLimit`. It defaults to `false`, so a copied workflow never spends Robux.
