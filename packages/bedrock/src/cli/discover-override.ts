import type { Stats } from "node:fs";
import { statSync } from "node:fs";
import { resolve } from "node:path";

const OVERRIDE_DIR_NAME = ".bedrock";
const OVERRIDE_EXTENSION = ".ts";

// Mirrors the shape of every built-in `sade` subcommand (`deploy`, `diff`,
// `migrate`). Rejecting anything else stops a malformed argv (`..`, `foo/bar`,
// `""`) from path-traversing out of `.bedrock/` via `resolve`.
const VALID_COMMAND = /^[a-z][a-z0-9-]*$/;

/**
 * Probes a path's filesystem metadata. Tests inject a fake to exercise
 * non-absence error paths (`EACCES`, malformed thrown values) that
 * real-fs fixtures cannot trigger reliably on Windows.
 */
export type StatProbe = (path: string) => Pick<Stats, "isFile">;

/**
 * Inputs to {@link discoverOverrideWith}. The stat seam is internal — the
 * public {@link discoverOverride} entry point binds it to `node:fs.statSync`.
 */
export interface DiscoverOverrideInputs {
	/** CLI subcommand name. Must match `/^[a-z][a-z0-9-]*$/`. */
	readonly command: string;
	/** Project root path. Relative inputs resolve against `process.cwd()`. */
	readonly projectRoot: string;
	/** Filesystem stat seam. */
	readonly stat: StatProbe;
}

/**
 * Stat-injectable variant of {@link discoverOverride}. Exported so tests can
 * drive `EACCES`-class errors and malformed-throw cases that real fs fixtures
 * cannot reliably produce on every supported OS.
 * @param inputs - {@link DiscoverOverrideInputs}.
 * @returns The absolute path to the override file when it exists, otherwise
 * `undefined`.
 */
export function discoverOverrideWith(inputs: DiscoverOverrideInputs): string | undefined {
	const { command, projectRoot, stat } = inputs;

	if (!VALID_COMMAND.test(command)) {
		return undefined;
	}

	const candidate = resolve(projectRoot, OVERRIDE_DIR_NAME, `${command}${OVERRIDE_EXTENSION}`);
	try {
		return stat(candidate).isFile() ? candidate : undefined;
	} catch (err) {
		if (isAbsenceError(err)) {
			return undefined;
		}

		throw err;
	}
}

/**
 * Resolve the path of a user-authored `.bedrock/<command>.ts` override for
 * the given command, or return `undefined` when no such file exists.
 *
 * The CLI uses this primitive to decide whether a subcommand invocation
 * should be handed to an override script or run through the built-in path.
 * `undefined` therefore means "fall through to the built-in implementation",
 * so only absence-style stat failures (`ENOENT`, `ENOTDIR`) are swallowed.
 * Permission and other errors propagate; the dispatcher must refuse to
 * silently route a `deploy` (or any other destructive command) through the
 * built-in path when the override file demonstrably exists but is
 * unreadable.
 *
 * `command` is validated against the subcommand grammar before any path
 * construction. An out-of-shape input cannot be a real subcommand and
 * returns `undefined` without touching the filesystem.
 * @param projectRoot - Absolute path of the directory `bedrock` was invoked
 * from. Relative inputs are resolved against `process.cwd()`.
 * @param command - The CLI subcommand name to look up (`deploy`, `diff`,
 * ...). Must match `/^[a-z][a-z0-9-]*$/`; anything else returns `undefined`.
 * @returns The absolute path to the override file when it exists, otherwise
 * `undefined`.
 * @throws When the stat call fails with anything other than `ENOENT` or
 * `ENOTDIR` (e.g. `EACCES`, `EPERM`).
 */
export function discoverOverride(projectRoot: string, command: string): string | undefined {
	return discoverOverrideWith({ command, projectRoot, stat: statSync });
}

function isAbsenceError(error: unknown): boolean {
	if (!(error instanceof Error) || !("code" in error)) {
		return false;
	}

	return error.code === "ENOENT" || error.code === "ENOTDIR";
}
