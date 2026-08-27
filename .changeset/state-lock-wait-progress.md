---
"@bedrock-rbx/core": patch
---

Surface a contended state-lock wait through the **Progress port**, so a deploy queued behind another run is visible rather than looking like a hang. `StateLockPort.acquire` takes an optional second argument: `operation` names what the hold is for, which a **Backend** whose lock record carries it writes down, and `onWaiting` is called each time the **Backend** backs off. The deploy shell supplies both, forwarding every wait as a new `stateLockWaiting` progress event carrying the environment, how long the wait has run, how long is left, and who holds the environment when the **Backend** could read that. The clack renderer prints the wait; a `ProgressPort` that switches exhaustively over `kind` needs a case for the new event. A `StateLockPort` implementing `acquire(environment)` alone keeps working untouched.
