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
	LuauExecutionTaskRef,
	SubmitAtHeadParameters,
	SubmitAtVersionParameters,
} from "../../domains/cloud-v2/luau-execution-tasks/types.ts";
import { buildUpdateRequest } from "../../domains/cloud-v2/places/builders.ts";
import {
	UPDATE_OPERATION_LIMIT,
	UPDATE_REQUIRED_SCOPES,
} from "../../domains/cloud-v2/places/operations.ts";
import { parsePlaceResponse } from "../../domains/cloud-v2/places/parsers.ts";
import type { Place, UpdatePlaceParameters } from "../../domains/cloud-v2/places/types.ts";
import { buildPublishRequest } from "../../domains/universes/places/builders.ts";
import {
	PUBLISH_OPERATION_LIMIT,
	PUBLISH_REQUIRED_SCOPES,
} from "../../domains/universes/places/operations.ts";
import { parsePublishResponse } from "../../domains/universes/places/parsers.ts";
import type { PlaceVersion, PublishParameters } from "../../domains/universes/places/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { CREATE_METHOD_DEFAULTS } from "../../internal/http/retry.ts";
import { ResourceClient, type ResourceMethodSpec } from "../../internal/resource-client.ts";
import type { Result } from "../../types.ts";
import { buildPollDeps, submitAndPoll } from "../luau-execution/polling-helpers.ts";
import { pollUntilDoneCore, type PollUntilDoneOptions } from "../luau-execution/polling.ts";

/**
 * Operation Group exposed by {@link PlacesClient} as the
 * `luauExecution` namespace. Provides `submit` to queue a Luau script,
 * `get` to fetch a task's current state, and `listLogs` to retrieve
 * structured log messages. Shares the same dispatch wiring as the
 * top-level `LuauExecutionClient` exposed at
 * `@bedrock-rbx/ocale/luau-execution`.
 *
 * @since 0.1.0
 */
export interface LuauExecutionHandle {
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
	 * Polls `get` with `view=BASIC` on a configurable backoff schedule until
	 * the task reaches a terminal state, the wall-clock budget is exhausted,
	 * or the supplied `AbortSignal` fires. Returns the terminal task on
	 * success.
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
	 * Submits a Luau script and polls `get` with `view=BASIC` until the
	 * task reaches a terminal state, the wall-clock budget is exhausted,
	 * or the supplied `AbortSignal` fires. Combines `submit` and
	 * `pollUntilDone` in one call.
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

function makePublishSpec(
	versionType: "Published" | "Saved",
): ResourceMethodSpec<PublishParameters, PlaceVersion> {
	return Object.freeze({
		buildRequest: (parameters: PublishParameters) =>
			buildPublishRequest(parameters, versionType),
		methodDefaults: CREATE_METHOD_DEFAULTS,
		methodKind: "create",
		operationLimit: PUBLISH_OPERATION_LIMIT,
		parse: parsePublishResponse,
		requiredScopes: PUBLISH_REQUIRED_SCOPES,
	});
}

const PUBLISH_SPEC = makePublishSpec("Published");
const SAVE_SPEC = makePublishSpec("Saved");

const UPDATE_SPEC: ResourceMethodSpec<UpdatePlaceParameters, Place> = Object.freeze({
	buildRequest: buildUpdateRequest,
	methodDefaults: {},
	methodKind: "idempotent",
	operationLimit: UPDATE_OPERATION_LIMIT,
	parse: parsePlaceResponse,
	requiredScopes: UPDATE_REQUIRED_SCOPES,
});

/**
 * Public client for the Roblox Open Cloud `Place` resource. Covers
 * place-version publishing (`publish`, `save`), place-configuration
 * updates (`update`), and the Luau execution Operation Group
 * (`luauExecution.submit`, `luauExecution.get`). Every method returns
 * a {@link Result} so callers handle failure explicitly; no thrown
 * {@link OpenCloudError} ever escapes the client.
 *
 * Publishing or saving a 5xx-failed place version is not retried
 * automatically: Roblox does not support idempotency keys, so a retry
 * could publish a duplicate version unnoticed. Callers that *can* detect
 * duplicates externally may opt back into 5xx retry per-call by passing
 * `retryableStatuses` on the second argument. The `update` method, by
 * contrast, is idempotent and retries both 429 and 5xx automatically.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import { PlacesClient } from "@bedrock-rbx/ocale/places";
 *
 * const client = new PlacesClient({ apiKey: "your-key" });
 * expect(client).toBeInstanceOf(PlacesClient);
 * ```
 */
export class PlacesClient {
	readonly #inner: ResourceClient;

	public readonly luauExecution: LuauExecutionHandle;

	/**
	 * Creates a new {@link PlacesClient}. Configuration is frozen on
	 * construction; per-request overrides are accepted on each method.
	 *
	 * @param options - Client-level configuration including the API key.
	 */
	constructor(options: OpenCloudClientOptions) {
		this.#inner = new ResourceClient(options);
		this.luauExecution = createLuauExecutionHandle(this.#inner);
	}

	/**
	 * Publishes a new live version of a place.
	 *
	 * No default request timeout applies to this upload; pass `options.timeout`
	 * to set a per-call deadline.
	 *
	 * @param parameters - Universe and place identifiers, the place file
	 *   bytes, and their declared `format`.
	 * @param options - Optional per-request overrides (e.g. A different
	 *   {@link OpenCloudClientOptions.apiKey} for this call only).
	 * @returns A {@link Result} wrapping the parsed {@link PlaceVersion}
	 *   or the {@link OpenCloudError} that caused the request to fail.
	 */
	public async publish(
		parameters: PublishParameters,
		options?: RequestOptions,
	): Promise<Result<PlaceVersion, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: PUBLISH_SPEC });
	}

	/**
	 * Saves a new draft version of a place. Identical to {@link publish}
	 * except the resulting version is not made live; consumers can list or
	 * promote it later. Shares a single per-API-key rate-limit queue with
	 * `publish` because Roblox attributes both calls to the same per-minute
	 * quota.
	 *
	 * No default request timeout applies to this upload; pass `options.timeout`
	 * to set a per-call deadline.
	 *
	 * @param parameters - Universe and place identifiers, the place file
	 *   bytes, and their declared `format`.
	 * @param options - Optional per-request overrides (e.g. A different
	 *   {@link OpenCloudClientOptions.apiKey} for this call only).
	 * @returns A {@link Result} wrapping the parsed {@link PlaceVersion}
	 *   or the {@link OpenCloudError} that caused the request to fail.
	 */
	public async save(
		parameters: PublishParameters,
		options?: RequestOptions,
	): Promise<Result<PlaceVersion, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: SAVE_SPEC });
	}

	/**
	 * Partially updates a place's configuration. The fields supplied on
	 * `parameters` (excluding the identifiers) are forwarded to the
	 * server via a Google-style `updateMask`; unmentioned fields are
	 * left untouched. The universe's root place is the canonical place
	 * to update when changing a universe's description or display name:
	 * both are derived server-side from the root place.
	 *
	 * @param parameters - The universe and place identifiers and the
	 *   fields to update. At least one writable field must be supplied.
	 * @param options - Optional per-request overrides (e.g. A different
	 *   {@link OpenCloudClientOptions.apiKey} for this call only).
	 * @returns A {@link Result} wrapping the parsed {@link Place} or
	 *   the {@link OpenCloudError} that caused the request to fail.
	 */
	public async update(
		parameters: UpdatePlaceParameters,
		options?: RequestOptions,
	): Promise<Result<Place, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: UPDATE_SPEC });
	}
}

function createLuauExecutionHandle(inner: ResourceClient): LuauExecutionHandle {
	return {
		async get(parameters, options) {
			return inner.execute({ options, parameters, spec: GET_SPEC });
		},
		async listLogs(parameters, options) {
			return inner.execute({ options, parameters, spec: LIST_LOGS_SPEC });
		},
		async pollUntilDone(ref, options = {}) {
			return pollUntilDoneCore(buildPollDeps(inner, { options, ref }), options);
		},
		async runUntilDone(parameters, options = {}) {
			return submitAndPoll(inner, { options, parameters });
		},
		async submit(parameters, options) {
			if ("versionId" in parameters) {
				return inner.execute({ options, parameters, spec: SUBMIT_VERSION_SPEC });
			}

			return inner.execute({ options, parameters, spec: SUBMIT_HEAD_SPEC });
		},
	};
}
