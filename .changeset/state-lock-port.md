---
"@bedrock-rbx/core": minor
---

Add an optional **State lock port** beside the **State port**, so a **Deploy** can take exclusion on one **Environment** instead of detecting a conflict at write time. A `StateLockPort` grants a hold through `acquire(environment)` and gives it up through the hold's `release()`. `deploy`, `provision`, and `publish` take the hold before any **Driver** runs and give it up once the **State** write has been attempted, on success and on failure paths alike, because a write that failed after apply is exactly when the operator needs to run again. A hold that cannot be given up never replaces the deploy's own result, so the failure carrying resources that were applied but not recorded reaches the caller intact.

Locking is a declared capability. A `StateBackendDeclaration` claims it by supplying `createLockPort`; omitting it declares a **Backend** that does not lock, which is still a valid **Backend** and deploys exactly as before. The builtin gist **Backend** declares none. `stateLockingCapabilityOf` reports the exclusion a resolved `state` block provides, so the guarantee in force is visible when a user chooses where **State** lives rather than discovered during an incident. `buildStateBackend` resolves both of a **Backend**'s ports together; `buildStatePort` is unchanged.

`DeployError` gains a `lockAcquireFailed` arm, so an exhaustive `switch` over it needs a new case. A deploy that returns it applied no **Operation** at all.
