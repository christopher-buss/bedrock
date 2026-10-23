import { GET_SPEC } from "../../domains/cloud-v2/luau-execution-tasks/specs.ts";
import type {
	LuauExecutionTask,
	LuauExecutionTaskRef,
	SubmitAtHeadParameters,
	SubmitAtVersionParameters,
} from "../../domains/cloud-v2/luau-execution-tasks/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import type { ResourceClient } from "../../internal/resource-client.ts";
import type { Result } from "../../types.ts";
import { type LuauExecutionRunOptions, submitWithCapacityAsync } from "./capacity-admission.ts";
import {
	budgetFailure,
	openPollBudget,
	type PollDependencies,
	pollUntilDoneCoreAsync,
	type PollUntilDoneOptions,
} from "./polling.ts";

/**
 * Builds the {@link PollDependencies} bundle used by {@link
 * pollUntilDoneCoreAsync}, closing over the supplied {@link ResourceClient},
 * task ref, and per-request options so the core loop stays narrow.
 *
 * @param inner - The {@link ResourceClient} that issues each `tasks.get` call.
 * @param args - The polling options and the task ref to fetch on every iteration.
 * @returns A {@link PollDependencies} bundle wiring `fetch`, `now`, and `sleep`.
 */
export function buildPollDependencies(
	inner: ResourceClient,
	args: { options: PollUntilDoneOptions; ref: LuauExecutionTaskRef },
): PollDependencies {
	return {
		fetch: async (deadlineMs) => {
			return inner.executeAsync({
				options: withRequestDeadline(args.options, deadlineMs),
				parameters: { ref: args.ref, view: "BASIC" },
				spec: GET_SPEC,
			});
		},
		now: Date.now,
		sleep: inner.sleep,
	};
}

/**
 * Submits a Luau execution task and polls it to a terminal state. Dispatches
 * to the head-version or specific-version submit spec based on the presence of
 * `versionId`, then delegates to {@link pollUntilDoneCoreAsync}. The poll
 * budget opens before the submit, so `timeoutMs` covers the submit and the
 * polling together; a submit cut off by the budget returns
 * `PollTimeoutError` with no task.
 *
 * @param inner - The {@link ResourceClient} that issues submit and poll calls.
 * @param args - The polling options and submit parameters.
 * @returns A {@link Result} wrapping the terminal {@link LuauExecutionTask}, or
 *   the {@link OpenCloudError} that caused submit or polling to fail.
 */
export async function submitAndPollAsync(
	inner: ResourceClient,
	{
		options,
		parameters,
	}: {
		options: LuauExecutionRunOptions;
		parameters: SubmitAtHeadParameters | SubmitAtVersionParameters;
	},
): Promise<Result<LuauExecutionTask, OpenCloudError>> {
	const startedAt = Date.now();
	const budget = openPollBudget(startedAt, options);
	const submitResult = await submitWithCapacityAsync({
		inner,
		options: withRequestDeadline(options, budget.requestDeadlineMs),
		parameters,
	});
	if (!submitResult.success) {
		return {
			err: budgetFailure(submitResult.err, {
				budget,
				lastTask: undefined,
				signal: options.signal,
			}),
			success: false,
		};
	}

	return pollUntilDoneCoreAsync(
		{ ...buildPollDependencies(inner, { options, ref: submitResult.data.ref }), startedAt },
		options,
	);
}

/**
 * Applies the budget's request deadline. It already folds in the caller's own
 * `deadlineMs`, so it is `undefined` only when the caller set none either.
 *
 * @template TOptions - The concrete option shape to preserve.
 * @param options - The caller's options.
 * @param deadlineMs - The request deadline from the opened budget.
 * @returns The options with `deadlineMs` set to the request deadline.
 */
function withRequestDeadline<TOptions extends PollUntilDoneOptions>(
	options: TOptions,
	deadlineMs: number | undefined,
): TOptions {
	return { ...options, deadlineMs };
}
