import { join } from "node:path";

/** Directory, relative to the project root, holding recovery dumps. */
const RECOVERY_DIRECTORY = join(".bedrock", "recovery");

/**
 * Directory the recovery dumps live in, one JSON file per **Environment**.
 * Predictable so a user who lost a **State** write can find the record
 * without being told where it went.
 *
 * @param projectRoot - Directory the CLI is running against.
 * @returns The absolute recovery directory path.
 */
export function recoveryDirectory(projectRoot: string): string {
	return join(projectRoot, RECOVERY_DIRECTORY);
}

/**
 * Path of one **Environment**'s recovery dump. A later failed write for the
 * same environment overwrites it: the newest unsaved record is the only one
 * worth pushing.
 *
 * @param projectRoot - Directory the CLI is running against.
 * @param environment - Environment whose unsaved state was dumped.
 * @returns The absolute path of that environment's dump.
 */
export function recoveryFilePath(projectRoot: string, environment: string): string {
	return join(recoveryDirectory(projectRoot), `${environment}.json`);
}

/**
 * The command that pushes a dumped **State** to the configured **Backend**,
 * quoted back to the user at the moment the write failed. A deploy that was
 * pointed at an explicit config quotes the same `--config`, so the push
 * resolves the project the failed deploy was actually running.
 *
 * @param environment - Environment whose dump would be pushed.
 * @param configFile - Explicit config path the failed run was given, if any.
 * @returns The command line to run.
 */
export function recoveryPushCommand(environment: string, configFile?: string): string {
	const config = configFile === undefined ? "" : ` --config ${configFile}`;
	return `bedrock state push --env ${environment}${config}`;
}
