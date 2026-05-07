import type { OpenCloudClientOptions, RequestOptions } from "../../client/types.ts";
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

interface TasksHandle {
	get(
		parameters: GetParameters,
		options?: RequestOptions,
	): Promise<Result<LuauExecutionTask, OpenCloudError>>;
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
		async submit(parameters, options) {
			if ("versionId" in parameters) {
				return inner.execute({ options, parameters, spec: SUBMIT_VERSION_SPEC });
			}

			return inner.execute({ options, parameters, spec: SUBMIT_HEAD_SPEC });
		},
	};
}
