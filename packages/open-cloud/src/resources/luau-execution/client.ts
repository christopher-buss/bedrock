import type { OpenCloudClientOptions, RequestOptions } from "../../client/types.ts";
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
	SubmitAtHeadParameters,
	SubmitAtVersionParameters,
} from "../../domains/cloud-v2/luau-execution-tasks/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { ResourceClient } from "../../internal/resource-client.ts";
import type { Result } from "../../types.ts";

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
 * specific place version, plus `tasks.get` for fetching task state.
 */
export class LuauExecutionClient {
	readonly #inner: ResourceClient;

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
		this.tasks = createTasksHandle(this.#inner);
	}
}

function createTasksHandle(inner: ResourceClient): TasksHandle {
	return {
		async get(parameters, options) {
			return inner.execute({ options, parameters, spec: GET_SPEC });
		},
		async listLogs(parameters, options) {
			return inner.execute({ options, parameters, spec: LIST_LOGS_SPEC });
		},
		async submit(parameters, options) {
			if ("versionId" in parameters) {
				return inner.execute({ options, parameters, spec: SUBMIT_VERSION_SPEC });
			}

			return inner.execute({ options, parameters, spec: SUBMIT_HEAD_SPEC });
		},
	};
}
