---
"@bedrock-rbx/ocale": minor
---

Luau-execution `pollUntilDone` and `runUntilDone` now bound every in-flight submit and poll request by the remaining `timeoutMs` budget, through the request `deadlineMs`. **Breaking:** when the budget runs out, the call returns `PollTimeoutError` carrying the last observed task (with the `RequestDeadlineExceededError` as `cause`), where a request that hung past its own timeout used to return `NetworkError`. For `runUntilDone` the budget now opens before the submit and covers it. A caller-supplied `signal` still wins with `PollAbortedError`. The places client's `luauExecution` namespace now also derives its request `timeout` from the budget.
