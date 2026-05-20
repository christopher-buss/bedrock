import type { Result } from "@bedrock-rbx/ocale";

import { spawn } from "node:child_process";
import process from "node:process";

import type { Spawner, SpawnInvocation, SpawnLaunchError } from "./spawner.ts";

/**
 * Translate a `child.on("close", code, signal)` payload into the
 * {@link Spawner.spawn} return shape. Extracted from the adapter so the
 * signal-terminated branch can be exercised without launching a real
 * process. The caller normalizes node's `null` to `undefined` at the
 * boundary so this helper never sees `null`.
 * @param code - Exit code reported by the child, or `undefined` if the
 *   child was terminated by a signal before exiting.
 * @param signal - Signal name reported by the child, or `undefined` when
 *   no signal terminated it.
 * @returns `Ok(code)` for a clean exit (including `0`); otherwise
 *   `Err(launchFailed)` carrying a synthetic Error whose message names
 *   the signal.
 */
export function classifySpawnClose(
	code: number | undefined,
	signal: NodeJS.Signals | undefined,
): Result<number, SpawnLaunchError> {
	if (code !== undefined) {
		return { data: code, success: true };
	}

	const cause: NodeJS.ErrnoException = new Error(
		`spawned process terminated by signal ${signal ?? "unknown"}`,
	);
	return { err: { cause, kind: "launchFailed" }, success: false };
}

/**
 * Construct a {@link Spawner} backed by `node:child_process.spawn` with
 * `stdio` inherited from the parent process. The child's environment is
 * `process.env` overlaid with {@link SpawnInvocation.envOverrides} (overrides
 * win on key collision).
 *
 * - Exit codes resolve as `Ok(exitCode)` (including `0`).
 * - `ENOENT` and other launch-time `ErrnoException`s resolve as
 *   `Err(launchFailed)` with the original error.
 * - Children terminated by signal before producing an exit code collapse
 *   into `launchFailed` with a synthetic `Error` whose message names the
 *   signal; a distinct variant lands the day a caller needs to act on the
 *   difference.
 *
 * @returns A `Spawner` whose `spawn` settles once the child closes.
 * @example
 *
 * ```ts
 * import { createDefaultSpawner } from "@bedrock-rbx/core";
 * import process from "node:process";
 *
 * const spawner = createDefaultSpawner();
 *
 * return spawner
 *     .spawn({
 *         args: ["-e", "process.exit(0)"],
 *         command: process.execPath,
 *         envOverrides: {},
 *     })
 *     .then((result) => {
 *         expect(result.success).toBeTrue();
 *         if (result.success) {
 *             expect(result.data).toBe(0);
 *         }
 *     });
 * ```
 */
export function createDefaultSpawner(): Spawner {
	return { spawn: spawnViaChildProcess };
}

async function spawnViaChildProcess(invocation: SpawnInvocation): ReturnType<Spawner["spawn"]> {
	return new Promise((resolve) => {
		const child = spawn(invocation.command, [...invocation.args], {
			env: { ...process.env, ...invocation.envOverrides },
			stdio: "inherit",
		});

		child.once("error", (error: NodeJS.ErrnoException) => {
			resolve({ err: { cause: error, kind: "launchFailed" }, success: false });
		});

		child.once("close", (code, signal) => {
			resolve(classifySpawnClose(code ?? undefined, signal ?? undefined));
		});
	});
}
