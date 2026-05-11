import {
	GET_SPEC,
	SUBMIT_HEAD_SPEC,
	SUBMIT_VERSION_SPEC,
} from "../../domains/cloud-v2/luau-execution-tasks/specs.ts";
import type {
	LuauExecutionTask,
	LuauExecutionTaskRef,
	SubmitAtHeadParameters,
	SubmitAtVersionParameters,
} from "../../domains/cloud-v2/luau-execution-tasks/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import type { ResourceClient } from "../../internal/resource-client.ts";
import type { Result } from "../../types.ts";
import { type PollDeps, pollUntilDoneCore, type PollUntilDoneOptions } from "./polling.ts";

/**
 * Builds the {@link PollDeps} bundle used by {@link pollUntilDoneCore},
 * closing over the supplied {@link ResourceClient}, task ref, and
 * per-request options so the core loop stays narrow.
 *
 * @param inner - The {@link ResourceClient} that issues each `tasks.get` call.
 * @param args - The polling options and the task ref to fetch on every iteration.
 * @returns A {@link PollDeps} bundle wiring `fetch`, `now`, and `sleep`.
 */
export function buildPollDeps(
	inner: ResourceClient,
	args: { options: PollUntilDoneOptions; ref: LuauExecutionTaskRef },
): PollDeps {
	return {
		fetch: async () => {
			return inner.execute({
				options: args.options,
				parameters: { ref: args.ref, view: "BASIC" },
				spec: GET_SPEC,
			});
		},
		now: Date.now,
		sleep: inner.sleep,
	};
}

/**
 * Submits a Luau execution task and polls it to a terminal state.
 * Dispatches to the head-version or specific-version submit spec based on
 * the presence of `versionId`, then delegates to {@link pollUntilDoneCore}.
 *
 * @param inner - The {@link ResourceClient} that issues submit and poll calls.
 * @param args - The polling options and submit parameters.
 * @returns A {@link Result} wrapping the terminal {@link LuauExecutionTask}, or
 *   the {@link OpenCloudError} that caused submit or polling to fail.
 */
export async function submitAndPoll(
	inner: ResourceClient,
	args: {
		options: PollUntilDoneOptions;
		parameters: SubmitAtHeadParameters | SubmitAtVersionParameters;
	},
): Promise<Result<LuauExecutionTask, OpenCloudError>> {
	const { options, parameters } = args;
	const submitResult = await ("versionId" in parameters
		? inner.execute({ options, parameters, spec: SUBMIT_VERSION_SPEC })
		: inner.execute({ options, parameters, spec: SUBMIT_HEAD_SPEC }));
	if (!submitResult.success) {
		return submitResult;
	}

	return pollUntilDoneCore(
		buildPollDeps(inner, { options, ref: submitResult.data.ref }),
		options,
	);
}
