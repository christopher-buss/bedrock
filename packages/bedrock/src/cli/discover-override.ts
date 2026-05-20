import { statSync } from "node:fs";
import { resolve } from "node:path";

const OVERRIDE_DIR_NAME = ".bedrock";
const OVERRIDE_EXTENSION = ".ts";

/**
 * Resolve the path of a user-authored `.bedrock/<command>.ts` override for the
 * given command, or return `undefined` when no such file exists.
 *
 * The CLI uses this primitive to decide whether a subcommand invocation should
 * be handed to an override script or run through the built-in path. The
 * folder name and file extension are fixed; only an exact filename match for
 * the requested command is considered.
 * @param projectRoot - The directory `bedrock` was invoked from, against which
 * `.bedrock/<command>.ts` is resolved.
 * @param command - The CLI subcommand name to look up (`deploy`, `diff`, ...).
 * @returns The absolute path to the override file when it exists, otherwise
 * `undefined`.
 */
export function discoverOverride(projectRoot: string, command: string): string | undefined {
	const candidate = resolve(projectRoot, OVERRIDE_DIR_NAME, `${command}${OVERRIDE_EXTENSION}`);
	try {
		return statSync(candidate).isFile() ? candidate : undefined;
	} catch {
		return undefined;
	}
}
