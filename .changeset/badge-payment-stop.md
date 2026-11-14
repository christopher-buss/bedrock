---
"@bedrock-rbx/core": patch
---

Stop paying for badge creates after a payment error. After Roblox refuses a paid badge create for insufficient funds or a missing group spend permission, or answers it with a server error, the deploy sends no further paid create. Each badge it did not pay for fails with a `BadgePaymentStoppedError` that names the cause, or is deferred where the Environment allows Deferred creates. A paid create answered with a server error fails with an `UnconfirmedPaidCreateError`, and the report says it may have completed and charged.
