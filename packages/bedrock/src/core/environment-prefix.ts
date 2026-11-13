import type { Config, EnvironmentEntry } from "./schema.ts";
import { resolvePrefix } from "./select-environment.ts";

/**
 * The display-name prefix an Environment renders from the project's
 * `displayNamePrefix` setting and the Environment's label.
 *
 * @param config - Config holding the prefix setting and each Environment's
 *   label.
 * @param environment - The Environment whose prefix to render.
 * @returns The prefix, or `""` when the Environment renders none.
 */
export function environmentPrefix(
	config: Pick<Config, "displayNamePrefix"> & {
		readonly environments: Readonly<Record<string, Pick<EnvironmentEntry, "label">>>;
	},
	environment: string,
): string {
	return resolvePrefix(config, { ...config.environments[environment] }) ?? "";
}

/**
 * Remove a display-name prefix from the start of a name.
 *
 * @param shown - The name as shown, perhaps prefixed.
 * @param prefix - The prefix to remove; `""` removes nothing.
 * @returns The name without the prefix, or `shown` when it does not start
 *   with it.
 */
export function withoutPrefix(shown: string, prefix: string): string {
	return shown.startsWith(prefix) ? shown.slice(prefix.length) : shown;
}
