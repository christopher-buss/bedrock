import {
	CREATE_METHOD_DEFAULTS,
	IDEMPOTENT_METHOD_DEFAULTS,
} from "../../../internal/http/retry.ts";
import { okRequest, type ResourceMethodSpec } from "../../../internal/resource-client.ts";
import {
	buildGetRequest,
	buildSubmitAtHeadRequest,
	buildSubmitAtVersionRequest,
} from "./builders.ts";
import {
	GET_OPERATION_LIMIT,
	GET_REQUIRED_SCOPES,
	SUBMIT_OPERATION_LIMIT,
	SUBMIT_REQUIRED_SCOPES,
} from "./operations.ts";
import { parseLuauExecutionTaskResponse } from "./parsers.ts";
import type {
	GetParameters,
	LuauExecutionTask,
	SubmitAtHeadParameters,
	SubmitAtVersionParameters,
} from "./types.ts";

function makeSpec<P>(
	spec: ResourceMethodSpec<P, LuauExecutionTask>,
): ResourceMethodSpec<P, LuauExecutionTask> {
	return Object.freeze(spec);
}

/**
 * Per-method dispatch spec for submitting a Luau execution task at a
 * place's head version. Frozen at module scope so both the top-level
 * `LuauExecutionClient` and the `luauExecution` Operation Group on
 * `PlacesClient` share the same instance reference.
 */
export const SUBMIT_HEAD_SPEC = makeSpec<SubmitAtHeadParameters>({
	buildRequest: (parameters) => okRequest(buildSubmitAtHeadRequest(parameters)),
	methodDefaults: CREATE_METHOD_DEFAULTS,
	methodKind: "create",
	operationLimit: SUBMIT_OPERATION_LIMIT,
	parse: parseLuauExecutionTaskResponse,
	requiredScopes: SUBMIT_REQUIRED_SCOPES,
});

/**
 * Per-method dispatch spec for submitting a Luau execution task at a
 * specific place version. Shares the rate-limit queue and required
 * scope set with {@link SUBMIT_HEAD_SPEC} because Roblox attributes
 * both URL shapes to one per-minute quota.
 */
export const SUBMIT_VERSION_SPEC = makeSpec<SubmitAtVersionParameters>({
	buildRequest: (parameters) => okRequest(buildSubmitAtVersionRequest(parameters)),
	methodDefaults: CREATE_METHOD_DEFAULTS,
	methodKind: "create",
	operationLimit: SUBMIT_OPERATION_LIMIT,
	parse: parseLuauExecutionTaskResponse,
	requiredScopes: SUBMIT_REQUIRED_SCOPES,
});

/**
 * Per-method dispatch spec for fetching a Luau execution task. Uses
 * idempotent retry semantics (429 and 5xx both retried) so reads
 * recover transparently from transient server errors.
 */
export const GET_SPEC = makeSpec<GetParameters>({
	buildRequest: buildGetRequest,
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: GET_OPERATION_LIMIT,
	parse: parseLuauExecutionTaskResponse,
	requiredScopes: GET_REQUIRED_SCOPES,
});
