/** Variables a test worker keeps from the shell that launched it. */
export interface EnvironmentAllowlist {
	/** Exact variable names, matched without regard to case. */
	readonly names: ReadonlyArray<string>;
	/** Name prefixes, matched without regard to case. */
	readonly prefixes: ReadonlyArray<string>;
}

/**
 * What a test worker keeps: what the OS, the runtime, and the test tooling
 * need to run and to spawn child processes, plus tool locations that are not
 * secrets. Everything a test depends on beyond this, it sets itself with
 * `vi.stubEnv`.
 */
export const TEST_ENVIRONMENT_ALLOWLIST: EnvironmentAllowlist = {
	names: [
		"APPDATA",
		"BEDROCK_LUTE_PATH",
		"CI",
		"COMSPEC",
		"FORCE_COLOR",
		"HOME",
		"LANG",
		"LC_ALL",
		"LOCALAPPDATA",
		"NO_COLOR",
		"NODE_ENV",
		"NODE_OPTIONS",
		"NUMBER_OF_PROCESSORS",
		"OS",
		"PATH",
		"PATHEXT",
		"PROCESSOR_ARCHITECTURE",
		"PROGRAMDATA",
		"PROGRAMFILES",
		"PROGRAMFILES(X86)",
		"SYSTEMDRIVE",
		"SYSTEMROOT",
		"TEMP",
		"TERM",
		"TEST",
		"TMP",
		"TMPDIR",
		"TZ",
		"USERPROFILE",
		"WINDIR",
	],
	prefixes: ["BUN_", "VITEST"],
};

/**
 * Delete every variable the allowlist does not cover, in place. Windows
 * spells some names in mixed case (`Path`), so matching ignores case.
 *
 * @param environment - The environment to prune, usually `process.env`.
 * @param allowlist - The names and prefixes to keep.
 */
export function isolateEnvironment(
	environment: Record<string, string | undefined>,
	allowlist: EnvironmentAllowlist,
): void {
	const names = new Set(allowlist.names.map((name) => name.toUpperCase()));
	const prefixes = allowlist.prefixes.map((prefix) => prefix.toUpperCase());

	for (const name of Object.keys(environment)) {
		const upper = name.toUpperCase();
		if (!names.has(upper) && prefixes.every((prefix) => !upper.startsWith(prefix))) {
			delete environment[name];
		}
	}
}
