import type { OpenCloudClientOptions, RequestOptions } from "../../client/types.ts";
import { SUBMIT_HEAD_SPEC } from "../../domains/cloud-v2/luau-execution-tasks/specs.ts";
import type {
	LuauExecutionTask,
	SubmitAtHeadParameters,
} from "../../domains/cloud-v2/luau-execution-tasks/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { ResourceClient } from "../../internal/resource-client.ts";
import type { Result } from "../../types.ts";

interface TasksHandle {
	submit(
		parameters: SubmitAtHeadParameters,
		options?: RequestOptions,
	): Promise<Result<LuauExecutionTask, OpenCloudError>>;
}

/**
 * Public client for the Roblox Open Cloud `LuauExecutionSessionTask`
 * resource. Tasks run a Luau script against a place and surface state,
 * output, or error through the `LuauExecutionTask` discriminated
 * union. The current slice exposes `tasks.submit` for the place's head
 * version; later slices add the version variant and `tasks.get`.
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
		async submit(parameters, options) {
			return inner.execute({ options, parameters, spec: SUBMIT_HEAD_SPEC });
		},
	};
}
