import type { Result } from "@bedrock-rbx/ocale";

/**
 * Concrete invocation passed to {@link Spawner.spawn}: the executable name,
 * its argv, and an env-var override map layered on top of the host process
 * environment. The adapter is responsible for merging `envOverrides` with
 * `process.env` so overrides win on collisions.
 */
export interface SpawnInvocation {
	/** Argv to pass to the spawned executable, excluding the command itself. */
	readonly args: ReadonlyArray<string>;
	/** Executable name to spawn (e.g. `"bun"`). */
	readonly command: string;
	/** Env-var entries that should overlay the host process environment. */
	readonly envOverrides: Readonly<Record<string, string>>;
}

/**
 * Failure surfaced by {@link Spawner.spawn} when the child process could not
 * be started at all (e.g. `ENOENT` for a missing executable). Carries the
 * original `ErrnoException` so callers can render a precise diagnostic.
 */
export interface SpawnLaunchError {
	/** Underlying errno from `node:child_process`. */
	readonly cause: NodeJS.ErrnoException;
	/** Discriminator tag. */
	readonly kind: "launchFailed";
}

/**
 * Plugin contract for spawning a child process: the interface an adapter
 * (a `node:child_process` wrapper, a fake recorder in tests) implements to
 * let the CLI dispatch override scripts without binding to a concrete
 * process API.
 *
 * `Spawner` is a *driven* (secondary) port; the dispatcher drives the
 * spawner to perform a launch. Stdio is always inherited from the parent
 * process so the spawned script's output appears within the CLI's frame
 * in chronological order.
 */
export interface Spawner {
	/**
	 * Launch the supplied invocation and resolve once the child closes.
	 *
	 * - `Ok(exitCode)` carries the child's numeric exit code (including 0).
	 * - `Err(launchFailed)` covers cases where the child could not be
	 *   started at all (missing executable, permission denied, signal'd
	 *   before exit).
	 */
	spawn(invocation: SpawnInvocation): Promise<Result<number, SpawnLaunchError>>;
}
