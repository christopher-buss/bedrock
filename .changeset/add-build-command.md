---
"@bedrock-rbx/core": minor
---

Add a `bedrock build` CLI subcommand that produces place artifacts by discovering and spawning a `.bedrock/build.ts` override, using the same discovery and spawn contract as `.bedrock/deploy.ts` (credentials forwarded as env-var overrides, `--config`/`--env` in argv) and propagating the override's exit code. The build is entirely the override's job — there is no built-in default — so a project whose config enables `codegen` but ships no `.bedrock/build.ts` fails with an actionable message, while a project without codegen has nothing to produce and exits successfully. The command is independent of `deploy`: it loads config only when no override is present and can be run standalone.
