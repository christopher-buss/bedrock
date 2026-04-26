import process from "node:process";
import { isAgent } from "std-env";

// `process.stdout.write` (no trailing newline) so the hk pkl condition
// `exec("bun scripts/is-agent.ts") == "true"` matches. `console.log`
// would append "\n", causing every `condition = isAgent` step in
// hk.pkl to skip silently for everyone — agent or human.
process.stdout.write(isAgent ? "true" : "false");
