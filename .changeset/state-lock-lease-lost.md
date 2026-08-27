---
"@bedrock-rbx/core": patch
---

Surface a state lock **Lease** the **Backend** could not keep. `StateLockAcquireOptions` gains an optional `onLeaseLost`, which a locking **Backend** calls when it can no longer keep the lease on the hold a **Deploy** is running under, and `deploy` reports that through the **Progress port** as a new `stateLockLeaseLost` event the CLI renders as an error. A run whose hold is gone carried on silently before, and the operator learned about it only from the refused **State** write at the end. The write is what keeps the takeover safe either way: it is conditional on the **State** that was read, so a holder that kept running past its expired lease fails rather than overwriting whatever the run that took the **Environment** over recorded.
