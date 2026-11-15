---
"@bedrock-rbx/actions": patch
---

The deploy action starts the deploy command with `exec`, so a cancelled or timed-out job sends its signal to Bedrock, which then saves State before it exits.
