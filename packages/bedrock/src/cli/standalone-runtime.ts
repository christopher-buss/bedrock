// cspell:ignore bunfs
// Where a standalone Bun executable mounts its embedded modules: `/$bunfs/`
// on macOS and Linux, the `B:` drive on Windows.
const STANDALONE_URL_PREFIXES = ["file:///$bunfs/", "file:///B:/~BUN/"];

/**
 * Environment a child spawned on `process.execPath` needs to run a script
 * the way the invoking runtime would.
 *
 * Inside a standalone Bun executable, `process.execPath` is the bedrock
 * binary itself, which would read the script path as a command name.
 * `BUN_BE_BUN=1` makes the binary behave as the Bun runtime it embeds.
 *
 * @param moduleUrl - `import.meta.url` of a module bundled into the CLI.
 * @returns `{ BUN_BE_BUN: "1" }` when `moduleUrl` lies inside a standalone
 *   executable's virtual filesystem; otherwise an empty record.
 */
export function standaloneRuntimeEnvironment(moduleUrl: string): Readonly<Record<string, string>> {
	return STANDALONE_URL_PREFIXES.some((prefix) => moduleUrl.startsWith(prefix))
		? { BUN_BE_BUN: "1" }
		: {};
}
