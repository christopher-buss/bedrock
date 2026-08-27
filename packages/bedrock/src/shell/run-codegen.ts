import type { Result } from "@bedrock-rbx/ocale";

import {
	buildCodegenEnvironments,
	type CodegenFile,
	type Emitter,
	hashCodegenFilesAsync,
} from "../core/codegen.ts";
import { safeStringify } from "../core/error-chain.ts";
import type { BedrockState, StateError } from "../core/state.ts";
import type { CodegenWriteError, CodegenWriterPort } from "../ports/codegen-writer.ts";
import type { StatePort } from "../ports/state-port.ts";
import type { Sha256Hex } from "../types/ids.ts";

/**
 * Failure surfaced by {@link runCodegenAsync}. Stage-tagged so callers can
 * tell a cross-environment read failure from a thrown emitter or a write
 * failure.
 *
 * @since 0.1.0
 */
export type CodegenError =
	| { readonly cause: CodegenWriteError; readonly kind: "codegenWriteFailed" }
	| {
			readonly cause: StateError;
			readonly environment: string;
			readonly kind: "codegenStateReadFailed";
	  }
	| { readonly kind: "codegenEmitThrew"; readonly reason: string };

/**
 * Inputs for {@link runCodegenAsync}.
 */
interface RunCodegenInputs {
	/** Freshly merged snapshot of the environment just deployed. */
	readonly deployedState: BedrockState;
	/** Caller-supplied emitter that turns per-environment state into files. */
	readonly emit: Emitter;
	/** Every declared environment name, including the one just deployed. */
	readonly environments: ReadonlyArray<string>;
	/** Backend used to read the last-known state of the other environments. */
	readonly statePort: StatePort;
	/** Sink the emitted files are written through. */
	readonly writer: CodegenWriterPort;
}

/**
 * Assemble the current state of every declared environment, hand it to the
 * emitter, and write the returned files. The deployed environment uses the
 * freshly merged snapshot rather than re-reading state; every other
 * environment is read through `statePort` and a never-deployed one is
 * presented as an empty state.
 *
 * @param inputs - Deployed snapshot, declared environments, emitter, state
 * backend, and writer.
 * @returns The fingerprint of the emitted output once all files are written,
 * or a stage-tagged {@link CodegenError}.
 */
export async function runCodegenAsync(
	inputs: RunCodegenInputs,
): Promise<Result<Sha256Hex, CodegenError>> {
	const collected = await collectStatesAsync(inputs);
	if (!collected.success) {
		return collected;
	}

	let files: ReadonlyArray<CodegenFile>;
	try {
		files = await inputs.emit({ environments: buildCodegenEnvironments(collected.data) });
	} catch (err) {
		return {
			err: {
				kind: "codegenEmitThrew",
				reason: safeStringify(err),
			},
			success: false,
		};
	}

	const written = await writeFilesAsync(files, inputs.writer);
	if (!written.success) {
		return written;
	}

	return { data: await hashCodegenFilesAsync(files), success: true };
}

async function collectStatesAsync({
	deployedState,
	environments,
	statePort,
}: RunCodegenInputs): Promise<Result<Record<string, BedrockState | undefined>, CodegenError>> {
	const states: Record<string, BedrockState | undefined> = {};
	for (const environment of environments) {
		if (environment === deployedState.environment) {
			states[environment] = deployedState;
			continue;
		}

		const read = await statePort.read(environment);
		if (!read.success) {
			return {
				err: { cause: read.err, environment, kind: "codegenStateReadFailed" },
				success: false,
			};
		}

		states[environment] = read.data.state;
	}

	return { data: states, success: true };
}

async function writeFilesAsync(
	files: ReadonlyArray<CodegenFile>,
	writer: CodegenWriterPort,
): Promise<Result<void, CodegenError>> {
	for (const file of files) {
		const written = await writer.write(file);
		if (!written.success) {
			return { err: { cause: written.err, kind: "codegenWriteFailed" }, success: false };
		}
	}

	return { data: undefined, success: true };
}
