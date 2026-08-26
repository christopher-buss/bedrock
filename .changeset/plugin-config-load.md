---
"@bedrock-rbx/core": patch
---

Add an optional top-level `plugins` field to the project config: a list of module specifiers that `loadConfig` imports before validating the rest of the config. Specifiers resolve from the directory holding the config file, so a package name finds a plugin the project installed and a relative path finds one kept alongside the config. A specifier that does not resolve, throws while evaluating, or exports no plugin fails the load with a `pluginLoadFailed` error carrying the specifier, a `PluginLoadFailureReason`, and the underlying message, so a broken install surfaces at config load rather than after a deploy has already changed things on Roblox. Omitting `plugins` behaves exactly as before.
