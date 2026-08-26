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
 * quoted back to the user at the moment the write failed.
 *
 * @param environment - Environment whose dump would be pushed.
 * @returns The command line to run.
 */
export function recoveryPushCommand(environment: string): string {
	return `bedrock state push --env ${environment}`;
}
