---
"@bedrock-rbx/state-s3": patch
---

Prove the store honours conditional creates before relying on one for exclusion. Before the first hold of a deploy is taken, the backend writes a scratch object under `<prefix>/locks/.probe-<id>.json`, writes it again requiring the object to be absent, and reads the store's refusal of that second write as the proof. The scratch object is taken away once the store has answered, and the question is asked once per deploy however many holds follow it.

A store that takes the second write evaluated no condition, so it would hand every run that asks the same hold. That store gets no locking: the deploy stops with a `conditionalWritesIgnored` failure naming what the store did and what it means, rather than running unprotected. A deploy the user expected to be held is never quietly downgraded to one that is not. A store that could not be asked at all is refused on the same terms as `conditionalWritesUnproven`, carrying what it answered.

A store the probe could not reach at all answers nothing about itself, so that outcome is not held on to: the next hold asks again rather than inheriting a refusal the store never really gave.

The documented IAM policy now grants `s3:DeleteObject` alongside `s3:GetObject` and `s3:PutObject`, which is what lets the probe take its scratch object away. Without it the probe still answers, and the scratch objects are left for the lifecycle rule that expires the locks beside them.
