---
"@bedrock-rbx/core": patch
---

Fix `bedrock state move` rejecting every invocation with `invalid value for flag '--to-<key>'`. The `--to-<key>` placeholder registered for the help output reached the parser as a real flag holding no value, and the coordinate scan refused it before reading `--to-bucket` or any other coordinate, so no move could run. A flag nothing supplied is now skipped.
