---
"@bedrock-rbx/core": patch
---

Recover the deployment record when a **State** write fails after a successful **Apply**. The deploy now names the resources it applied but could not record, writes the unsaved **State** to `.bedrock/recovery/<environment>.json`, and points at `bedrock state push --env <environment>`, the new command that writes a dumped file to the **Backend** configured for that environment. Pushing reports how many resources it wrote and from where, refuses a file that does not parse, is missing, or records a different environment, and removes the file it pushed so it cannot later be replayed over a newer record. A deploy whose **State** write succeeded writes nothing locally.

The `stateWriteFailed` arm of `DeployError` gains `unrecorded`, the resources that pass applied upstream and the refused write never recorded. Resources an earlier write already persisted are absent from it, as are noops, so a programmatic caller can report what is untracked without diffing the snapshot itself.
