import type { RequestOptions } from "../../client/types.ts";
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
import { OpenCloudError } from "../../errors/base.ts";
import { RateLimitError } from "../../errors/rate-limit.ts";
import type { ResourceClient } from "../../internal/resource-client.ts";
import type { Result } from "../../types.ts";

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

/**
 * Per-request options for submitting a Luau execution task.
 *
 * @since unreleased
 */
export interface LuauExecutionSubmitOptions extends RequestOptions {
	/**
	 * Maximum milliseconds to spend waiting for occupied place capacity.
	 * Supplying this value opts the submission into capacity-aware admission.
	 */
	readonly capacityWaitMs?: number;
}

interface CapacitySubmitCall {
	readonly inner: ResourceClient;
	readonly options: LuauExecutionSubmitOptions | undefined;
	readonly parameters: SubmitAtHeadParameters | SubmitAtVersionParameters;
}

interface SubmitOnceCall extends CapacitySubmitCall {
	readonly options: RequestOptions;
	readonly refineError?: ((error: OpenCloudError) => OpenCloudError) | undefined;
}

interface ObserveBlockerCall {
	readonly blocker: LuauExecutionTaskRef;
	readonly inner: ResourceClient;
	readonly options: RequestOptions;
}

/**
 * A Luau task submission refused because validated tasks occupy the target
 * place's execution capacity.
 *
 * @since unreleased
 */
export class LuauExecutionCapacityError extends OpenCloudError {
	/** Validated task references reported as occupying the target place. */
	public readonly blockers: ReadonlyArray<LuauExecutionTaskRef>;
	public override readonly name = "LuauExecutionCapacityError";

	/**
	 * Creates a capacity failure from validated blocker references.
	 *
	 * @param blockers - Tasks reported as occupying the submitted place.
	 */
	constructor(blockers: ReadonlyArray<LuauExecutionTaskRef>) {
		super("Luau execution capacity is occupied", { code: "RESOURCE_EXHAUSTED" });
		this.blockers = blockers;
	}
}

/**
 * Submits through capacity admission when the caller opts in.
 *
 * @param call - Resource client, submit parameters, and per-request options.
 * @returns The submitted task or the failure that stopped admission.
 */
export async function submitWithCapacityAsync({
	inner,
	options,
	parameters,
}: CapacitySubmitCall): Promise<Result<LuauExecutionTask, OpenCloudError>> {
	const { capacityWaitMs, ...requestOptions } = options ?? {};
	if (capacityWaitMs === undefined) {
		return submitOnceAsync({ inner, options: requestOptions, parameters });
	}

	function refineError(error: OpenCloudError): OpenCloudError {
		return capacityErrorFrom(error, parameters) ?? error;
	}

	const call = { inner, options: requestOptions, parameters, refineError };
	const first = await submitOnceAsync(call);
	if (first.success) {
		return first;
	}

	if (!(first.err instanceof LuauExecutionCapacityError)) {
		return first;
	}

	const blocker = first.err.blockers[0];
	if (blocker === undefined || capacityWaitMs <= 0) {
		return first;
	}

	const observed = await observeBlockerAsync({ blocker, inner, options: requestOptions });
	if (!observed.success) {
		return observed;
	}

	return isTerminal(observed.data) ? submitOnceAsync(call) : observed;
}

async function observeBlockerAsync({
	blocker,
	inner,
	options,
}: ObserveBlockerCall): Promise<Result<LuauExecutionTask, OpenCloudError>> {
	return inner.executeAsync({
		options,
		parameters: { ref: blocker, view: "BASIC" as const },
		spec: GET_SPEC,
	});
}

function capacityMessage(details: JSONValue | undefined): string | undefined {
	if (details === null || typeof details !== "object" || Array.isArray(details)) {
		return undefined;
	}

	const code = Reflect.get(details, "code");
	const message = Reflect.get(details, "message");
	return code === "RESOURCE_EXHAUSTED" && typeof message === "string" ? message : undefined;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function blockerRefsFrom(
	message: string,
	parameters: SubmitAtHeadParameters | SubmitAtVersionParameters,
): ReadonlyArray<LuauExecutionTaskRef> {
	const universeId = escapeRegExp(parameters.universeId);
	const placeId = escapeRegExp(parameters.placeId);
	const pattern = new RegExp(
		`universes/(${universeId})/places/(${placeId})/versions/([1-9][0-9]*)/luau-execution-sessions/(${UUID_PATTERN})/tasks/(${UUID_PATTERN})`,
		"giu",
	);
	const unique = new Map<string, LuauExecutionTaskRef>();
	for (const match of message.matchAll(pattern)) {
		const [, matchedUniverseId, matchedPlaceId, versionId, sessionId, taskId] = match;
		if (
			matchedUniverseId === undefined ||
			matchedPlaceId === undefined ||
			versionId === undefined ||
			sessionId === undefined ||
			taskId === undefined
		) {
			continue;
		}

		const ref = Object.freeze({
			placeId: matchedPlaceId,
			sessionId,
			taskId,
			universeId: matchedUniverseId,
			versionId,
		});
		unique.set(`${versionId}/${sessionId}/${taskId}`, ref);
	}

	return Object.freeze([...unique.values()]);
}

function capacityErrorFrom(
	error: OpenCloudError,
	parameters: SubmitAtHeadParameters | SubmitAtVersionParameters,
): LuauExecutionCapacityError | undefined {
	if (!(error instanceof RateLimitError) || error.code !== "RESOURCE_EXHAUSTED") {
		return undefined;
	}

	const message = capacityMessage(error.details);
	if (message === undefined) {
		return undefined;
	}

	const blockers = blockerRefsFrom(message, parameters);
	return blockers.length === 0 ? undefined : new LuauExecutionCapacityError(blockers);
}

function isTerminal(task: LuauExecutionTask): boolean {
	return task.state === "CANCELLED" || task.state === "COMPLETE" || task.state === "FAILED";
}

async function submitOnceAsync({
	inner,
	options,
	parameters,
	refineError,
}: SubmitOnceCall): Promise<Result<LuauExecutionTask, OpenCloudError>> {
	return "versionId" in parameters
		? inner.executeAsync({ options, parameters, refineError, spec: SUBMIT_VERSION_SPEC })
		: inner.executeAsync({ options, parameters, refineError, spec: SUBMIT_HEAD_SPEC });
}
