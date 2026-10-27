import type { Result } from "@bedrock-rbx/ocale";

import type { ResolvedConfig } from "../core/schema.ts";
import type { BedrockState, StateError, StateRecord, StateVersion } from "../core/state.ts";
import { withoutVisibility, withVisibilityJournal } from "../core/universe-visibility.ts";
import type { StatePort } from "../ports/state-port.ts";
import type { DeployError } from "./deploy.ts";

type StageResult = Result<BedrockState, DeployError>;
interface Inputs {
	readonly config: ResolvedConfig;
	readonly environment: string;
	readonly run: (config: ResolvedConfig, port: StatePort) => Promise<StageResult>;
	readonly statePort: StatePort;
}
interface Context {
	readonly environment: string;
	journal: BedrockState["universeVisibility"];
}

/**
 * Cancel visibility ownership and preparation while retaining unknown outcomes.
 *
 * @param inputs - Current stage configuration, persistence, and runner.
 * @returns The ordinary stage outcome with truthful visibility recovery state.
 */
export async function runUnmanagedVisibilityAsync(inputs: Inputs): Promise<StageResult> {
	const context: Context = { environment: inputs.environment, journal: undefined };
	const result = await inputs.run(inputs.config, unmanagedPort(context, inputs.statePort));
	if (result.success) {
		return { data: unmanaged(context, result.data), success: true };
	}

	if (result.err.kind !== "stateWriteFailed") {
		return result;
	}

	return {
		err: { ...result.err, unsavedState: unmanaged(context, result.err.unsavedState) },
		success: false,
	};
}

function unmanaged({ journal }: Context, snapshot: BedrockState): BedrockState {
	const retained =
		journal?.status === "intent"
			? { status: journal.status, target: journal.target, universeId: journal.universeId }
			: undefined;
	return withVisibilityJournal(
		{ ...snapshot, resources: snapshot.resources.map(withoutVisibility) },
		retained,
	);
}

function unmanagedPort(context: Context, port: StatePort): StatePort {
	async function readAsync(environment: string): Promise<Result<StateRecord, StateError>> {
		const record = await port.read(environment);
		if (record.success && environment === context.environment) {
			context.journal = record.data.state?.universeVisibility;
		}

		return record;
	}

	async function writeAsync(
		snapshot: BedrockState,
		expected?: StateVersion,
	): Promise<Result<void, StateError>> {
		return port.write(unmanaged(context, snapshot), expected);
	}

	return { read: readAsync, write: writeAsync };
}
