import type { RequestOptions } from "../../client/types.ts";
import {
	SUBMIT_HEAD_SPEC,
	SUBMIT_VERSION_SPEC,
} from "../../domains/cloud-v2/luau-execution-tasks/specs.ts";
import type {
	LuauExecutionTask,
	SubmitAtHeadParameters,
	SubmitAtVersionParameters,
} from "../../domains/cloud-v2/luau-execution-tasks/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import type { ResourceClient } from "../../internal/resource-client.ts";
import type { Result } from "../../types.ts";
import { namesCapacityBlockers } from "./capacity-error.ts";

/** One Luau task submission attempt through the resource client. */
export interface SubmitOnceCall {
	/** The resource client the submit runs through. */
	readonly inner: ResourceClient;
	/** Per-request options for the attempt. */
	readonly options: RequestOptions;
	/** The submitted target. */
	readonly parameters: SubmitAtHeadParameters | SubmitAtVersionParameters;
	/** Optionally refines a transport error with capacity evidence. */
	readonly refineError?: ((error: OpenCloudError) => OpenCloudError) | undefined;
}

/**
 * Submits a Luau task once. A 429 naming tasks that occupy the place never
 * locks the submit operation out, whether or not the caller opted into
 * capacity admission: it clears when those tasks end.
 *
 * @param call - Resource client, submit parameters, options, and refinement.
 * @returns The submitted task or the failure the attempt produced.
 */
export async function submitOnceAsync({
	inner,
	options,
	parameters,
	refineError,
}: SubmitOnceCall): Promise<Result<LuauExecutionTask, OpenCloudError>> {
	function exemptsLockout(error: OpenCloudError): boolean {
		return namesCapacityBlockers(error, parameters);
	}

	const call = { exemptsLockout, options, refineError };
	return "versionId" in parameters
		? inner.executeAsync({ ...call, parameters, spec: SUBMIT_VERSION_SPEC })
		: inner.executeAsync({ ...call, parameters, spec: SUBMIT_HEAD_SPEC });
}
