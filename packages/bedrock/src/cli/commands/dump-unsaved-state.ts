import { serializeStateFile } from "../../core/state-file.ts";
import type { DeployError } from "../../shell/deploy.ts";
import { recoveryDirectory, recoveryFilePath, recoveryPushCommand } from "../recovery-file.ts";
import type { ClackPort } from "../render.ts";
import { describeUnknown } from "./describe-unknown.ts";

/** Filesystem and output seams the recovery dump is written through. */
export interface DumpUnsavedStateDeps {
	/** Output port the recovery lines are rendered to. */
	readonly clack: ClackPort;
	/** Creates the recovery directory, parents included. */
	readonly mkdir: (path: string) => Promise<void>;
	/** Directory the recovery dump is written under. */
	readonly projectRoot: string;
	/** Writes the serialized dump. */
	readonly writeFile: (path: string, contents: string) => Promise<void>;
}

/** The failed write to recover from, and the environment it was for. */
interface DumpUnsavedStateInputs {
	/** Environment whose state write failed. */
	readonly environment: string;
	/** The write failure, carrying the record the **Backend** never took. */
	readonly err: Extract<DeployError, { kind: "stateWriteFailed" }>;
}

/**
 * Report what a failed **State** write left untracked and dump the unsaved
 * record beside the project so it can be pushed later. Names the resources
 * this deploy applied but never recorded, writes the record to the
 * environment's recovery file, and quotes the command that pushes it.
 *
 * A dump that cannot be written is reported rather than thrown: the deploy
 * has already failed, and the reader needs the reason the fallback failed
 * too.
 *
 * @param deps - Filesystem and output seams.
 * @param inputs - The failed write and the environment it was for.
 */
export async function dumpUnsavedStateAsync(
	deps: DumpUnsavedStateDeps,
	{ environment, err }: DumpUnsavedStateInputs,
): Promise<void> {
	if (err.unrecorded.length > 0) {
		const named = err.unrecorded.map((resource) => `${resource.kind}.${resource.key}`);
		deps.clack.logError(`applied but not recorded: ${named.join(", ")}`);
	}

	const filePath = recoveryFilePath(deps.projectRoot, environment);
	try {
		await deps.mkdir(recoveryDirectory(deps.projectRoot));
		await deps.writeFile(filePath, serializeStateFile(err.unsavedState));
	} catch (err_) {
		deps.clack.logError(`unsaved state dump failed (${filePath}): ${describeUnknown(err_)}`);
		return;
	}

	deps.clack.logMessage(
		`unsaved state written to ${filePath}; push it with: ${recoveryPushCommand(environment)}`,
	);
}
