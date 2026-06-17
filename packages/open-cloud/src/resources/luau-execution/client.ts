import type { OpenCloudClientOptions, RequestOptions } from "../../client/types.ts";
import { buildCreateBinaryInputRequest } from "../../domains/cloud-v2/luau-execution-task-binary-inputs/builders.ts";
import {
	CREATE_OPERATION_LIMIT,
	CREATE_REQUIRED_SCOPES,
} from "../../domains/cloud-v2/luau-execution-task-binary-inputs/operations.ts";
import { parseBinaryInputResponse } from "../../domains/cloud-v2/luau-execution-task-binary-inputs/parsers.ts";
import type {
	CreateBinaryInputParameters,
	LuauExecutionTaskBinaryInput,
} from "../../domains/cloud-v2/luau-execution-task-binary-inputs/types.ts";
import { LIST_LOGS_SPEC } from "../../domains/cloud-v2/luau-execution-task-logs/specs.ts";
import type {
	ListLogsParameters,
	LogPage,
} from "../../domains/cloud-v2/luau-execution-task-logs/types.ts";
import {
	GET_SPEC,
	SUBMIT_HEAD_SPEC,
	SUBMIT_VERSION_SPEC,
} from "../../domains/cloud-v2/luau-execution-tasks/specs.ts";
import type {
	GetParameters,
	LuauExecutionTask,
	LuauExecutionTaskRef,
	SubmitAtHeadParameters,
	SubmitAtVersionParameters,
} from "../../domains/cloud-v2/luau-execution-tasks/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { CREATE_METHOD_DEFAULTS } from "../../internal/http/retry.ts";
import {
	okRequest,
	ResourceClient,
	type ResourceMethodSpec,
} from "../../internal/resource-client.ts";
import type { Result } from "../../types.ts";
import { buildPollDeps, submitAndPoll } from "./polling-helpers.ts";
import {
	pollUntilDoneCore,
	type PollUntilDoneOptions,
	withBudgetRequestTimeout,
} from "./polling.ts";

function makeSpec<P, R>(spec: ResourceMethodSpec<P, R>): ResourceMethodSpec<P, R> {
	return Object.freeze(spec);
}

const CREATE_BINARY_INPUT_SPEC = makeSpec<
	CreateBinaryInputParameters,
	LuauExecutionTaskBinaryInput
>({
	buildRequest: (parameters) => okRequest(buildCreateBinaryInputRequest(parameters)),
	methodDefaults: CREATE_METHOD_DEFAULTS,
	methodKind: "create",
	operationLimit: CREATE_OPERATION_LIMIT,
	parse: parseBinaryInputResponse,
	requiredScopes: CREATE_REQUIRED_SCOPES,
});

/**
 * Operation handle for the `binaryInputs` namespace on
 * {@link LuauExecutionClient}. Provides `create` to allocate a presigned
 * upload slot for binary script inputs.
 */
export interface BinaryInputsHandle {
	/**
	 * Allocates a presigned binary input upload slot. The returned
	 * `uploadUri` is a presigned `PUT` target; the caller uploads the
	 * binary data directly and passes `path` to `tasks.submit` as
	 * `binaryInput`.
	 *
	 * @param parameters - Universe identifier and the byte size of the
	 *   binary to upload.
	 * @param options - Optional per-request overrides.
	 * @returns A {@link Result} wrapping the parsed
	 *   {@link LuauExecutionTaskBinaryInput} or the {@link OpenCloudError}
	 *   that caused the request to fail.
	 */
	create(
		parameters: CreateBinaryInputParameters,
		options?: RequestOptions,
	): Promise<Result<LuauExecutionTaskBinaryInput, OpenCloudError>>;
}

/**
 * Operation handle exposed by {@link LuauExecutionClient} as the
 * `tasks` namespace. Provides `submit` to queue a Luau script, `get`
 * to fetch a task's current state, and `listLogs` to retrieve
 * structured log messages produced by a task.
 */
export interface TasksHandle {
	/**
	 * Fetches the current state of a previously-submitted Luau
	 * execution task. Uses idempotent retry semantics for both 429 and
	 * 5xx.
	 *
	 * @param parameters - The task ref plus an optional `view` selector.
	 * @param options - Optional per-request overrides (e.g. A different
	 *   {@link OpenCloudClientOptions.apiKey} for this call only).
	 * @returns A {@link Result} wrapping the parsed
	 *   {@link LuauExecutionTask} or the {@link OpenCloudError} that
	 *   caused the request to fail.
	 */
	get(
		parameters: GetParameters,
		options?: RequestOptions,
	): Promise<Result<LuauExecutionTask, OpenCloudError>>;
	/**
	 * Lists one page of structured log messages produced by a
	 * previously-submitted Luau execution task. Messages from multiple
	 * server-side chunks are flattened into a single ordered array.
	 * Uses idempotent retry semantics for both 429 and 5xx.
	 *
	 * @param parameters - The task ref and optional pagination controls
	 *   (`pageSize`, `pageToken`).
	 * @param options - Optional per-request overrides (e.g. A different
	 *   {@link OpenCloudClientOptions.apiKey} for this call only).
	 * @returns A {@link Result} wrapping the parsed {@link LogPage} or
	 *   the {@link OpenCloudError} that caused the request to fail.
	 */
	listLogs(
		parameters: ListLogsParameters,
		options?: RequestOptions,
	): Promise<Result<LogPage, OpenCloudError>>;
	/**
	 * Polls `tasks.get` with `view=BASIC` on a configurable backoff schedule
	 * until the task reaches a terminal state, the wall-clock budget is
	 * exhausted, or the supplied `AbortSignal` fires. Returns the terminal
	 * task on success.
	 *
	 * @param ref - Reference to the task to poll, typically returned by `submit`.
	 * @param options - Polling and per-request overrides.
	 * @returns A {@link Result} wrapping the terminal {@link LuauExecutionTask},
	 *   or an error if aborted, timed out, or the transport fails.
	 */
	pollUntilDone(
		ref: LuauExecutionTaskRef,
		options?: PollUntilDoneOptions,
	): Promise<Result<LuauExecutionTask, OpenCloudError>>;
	/**
	 * Submits a Luau script and polls `tasks.get` with `view=BASIC` until
	 * the task reaches a terminal state, the wall-clock budget is
	 * exhausted, or the supplied `AbortSignal` fires. Combines `submit`
	 * and `pollUntilDone` in one call.
	 *
	 * @param parameters - The same input accepted by `submit`.
	 * @param options - Polling and per-request overrides.
	 * @returns A {@link Result} wrapping the terminal
	 *   {@link LuauExecutionTask}, or an error if submit fails, the task
	 *   is aborted, timed out, or the transport fails.
	 */
	runUntilDone(
		parameters: SubmitAtHeadParameters | SubmitAtVersionParameters,
		options?: PollUntilDoneOptions,
	): Promise<Result<LuauExecutionTask, OpenCloudError>>;
	/**
	 * Submits a Luau script for execution against a place. Dispatches
	 * to the head-version URL when `versionId` is omitted, or to the
	 * specific-version URL when one is supplied. Both URL shapes share
	 * one rate-limit queue and one required-scope set.
	 *
	 * @param parameters - The universe and place identifiers, the
	 *   script to run, an optional `versionId`, and any other writable
	 *   submit fields.
	 * @param options - Optional per-request overrides (e.g. A different
	 *   {@link OpenCloudClientOptions.apiKey} for this call only).
	 * @returns A {@link Result} wrapping the parsed
	 *   {@link LuauExecutionTask} or the {@link OpenCloudError} that
	 *   caused the request to fail.
	 */
	submit(
		parameters: SubmitAtHeadParameters | SubmitAtVersionParameters,
		options?: RequestOptions,
	): Promise<Result<LuauExecutionTask, OpenCloudError>>;
}

/**
 * Public client for the Roblox Open Cloud `LuauExecutionSessionTask`
 * resource. Tasks run a Luau script against a place and surface state,
 * output, or error through the `LuauExecutionTask` discriminated
 * union. Exposes `tasks.submit` for both the head version and a
 * specific place version, `tasks.get` for fetching task state,
 * `tasks.listLogs` for fetching structured log messages, and
 * `binaryInputs.create` for allocating presigned upload slots.
 */
export class LuauExecutionClient {
	readonly #inner: ResourceClient;

	public readonly binaryInputs: BinaryInputsHandle;
	public readonly tasks: TasksHandle;

	/**
	 * Creates a new {@link LuauExecutionClient}. Configuration is frozen
	 * on construction; per-request overrides are accepted on each
	 * method.
	 *
	 * @param options - Client-level configuration including the API key.
	 */
	constructor(options: OpenCloudClientOptions) {
		this.#inner = new ResourceClient(options);
		this.binaryInputs = createBinaryInputsHandle(this.#inner);
		this.tasks = createTasksHandle(this.#inner);
	}
}

function createBinaryInputsHandle(inner: ResourceClient): BinaryInputsHandle {
	return {
		async create(parameters, options) {
			return inner.execute({ options, parameters, spec: CREATE_BINARY_INPUT_SPEC });
		},
	};
}

function createTasksHandle(inner: ResourceClient): TasksHandle {
	return {
		async get(parameters, options) {
			return inner.execute({ options, parameters, spec: GET_SPEC });
		},
		async listLogs(parameters, options) {
			return inner.execute({ options, parameters, spec: LIST_LOGS_SPEC });
		},
		async pollUntilDone(ref, options = {}) {
			const resolved = withBudgetRequestTimeout(options);
			return pollUntilDoneCore(buildPollDeps(inner, { options: resolved, ref }), resolved);
		},
		async runUntilDone(parameters, options = {}) {
			return submitAndPoll(inner, { options: withBudgetRequestTimeout(options), parameters });
		},
		async submit(parameters, options) {
			if ("versionId" in parameters) {
				return inner.execute({ options, parameters, spec: SUBMIT_VERSION_SPEC });
			}

			return inner.execute({ options, parameters, spec: SUBMIT_HEAD_SPEC });
		},
	};
}
