---
"@bedrock-rbx/core": minor
---

`bedrock import` respects redaction. A link in a redacted Environment compares the live item with the placeholders that Environment deploys, not the real values, so a linked item that holds the placeholders shows no difference. An item of a redacted source Environment whose name is a redaction placeholder is refused (reason `placeholder`): give it its real name on Roblox, then import it. Items of a redacted source Environment carry `ImportItem.redacted`, and the summary warns that the next deploy there replaces their live values with placeholders.
