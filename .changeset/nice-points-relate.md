---
"@bedrock-rbx/core": patch
---

Hold back a badge create that a failed paid create may already have made. When a paid badge create gets a server error, the deploy records it as unconfirmed in State. A later deploy sends no create for that badge: it adopts the one live badge with the same name, or refuses the deploy (or skips the create where the Environment allows Deferred creates) until the badge is imported or `bedrock deploy --confirm-no-badge <key>` confirms that no badge exists. `bedrock diff` lists the held creates.
