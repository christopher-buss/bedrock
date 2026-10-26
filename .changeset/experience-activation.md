---
"@bedrock-rbx/ocale": patch
---

Add `UniversesClient.activate` and `deactivate` to change experience visibility with Open Cloud credentials. Activation errors explain that a missing content maturity rating may cause a 403, and ambiguous 504 responses are verified by reading the universe's visibility.
